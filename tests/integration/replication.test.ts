import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getPool } from '../../src/infra/db.js';
import { createPuller, defaultDeps, type PullerRow } from '../../src/replication/puller.js';
import { resetDb, stopTestProjector } from './helpers.js';
import { tickOnce } from '../../src/projector/loop.js';

let fakePrimary: Server;
let fakePrimaryUrl: string;
let fakePrimaryEvents: PullerRow[] = [];
let fakePrimaryTip = 0;

beforeAll(async () => {
  const app = express();
  app.get('/admin/events', (req, res) => {
    const after = Number(req.query.after ?? 0);
    const limit = Number(req.query.limit ?? 500);
    const filtered = fakePrimaryEvents.filter(e => e.globalSeq > after).slice(0, limit);
    res.setHeader('X-Primary-Tip', String(fakePrimaryTip));
    res.json(filtered);
  });
  await new Promise<void>(resolve => {
    fakePrimary = app.listen(0, () => resolve());
  });
  const addr = fakePrimary.address() as AddressInfo;
  fakePrimaryUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await stopTestProjector();
  await new Promise<void>(resolve => fakePrimary.close(() => resolve()));
});

beforeEach(async () => {
  await stopTestProjector();
  await resetDb();
  fakePrimaryEvents = [];
  fakePrimaryTip = 0;
});

describe('event-log replication', () => {
  it('the puller copies events from the fake primary into the local DB', async () => {
    fakePrimaryEvents = [
      {
        globalSeq: 1,
        streamId: 'account-x',
        version: 1,
        type: 'AccountOpened',
        payload: { accountId: 'x', owner: 'Alice', initialDeposit: 1000 },
        metadata: { correlation_id: 'c1', causation_id: 'c1' },
        createdAt: '2026-05-21T12:00:00.000Z',
      },
      {
        globalSeq: 2,
        streamId: 'account-x',
        version: 2,
        type: 'MoneyDeposited',
        payload: { accountId: 'x', amount: 500 },
        metadata: { correlation_id: 'c2', causation_id: 'c2' },
        createdAt: '2026-05-21T12:00:01.000Z',
      },
    ];
    fakePrimaryTip = 2;

    const puller = createPuller({
      primaryUrl: fakePrimaryUrl,
      pollMs: 0,
      deps: defaultDeps(),
    });

    await puller.tickOnce();

    const { rows } = await getPool().query(
      `SELECT global_seq, stream_id, version, type FROM events ORDER BY global_seq`,
    );
    expect(rows.map(r => Number(r.global_seq))).toEqual([1, 2]);
    expect(rows[0].type).toBe('AccountOpened');
    expect(puller.getState().observedPrimaryTip).toBe(2);
  });

  it('the local projector builds projections from the pulled events', async () => {
    fakePrimaryEvents = [
      {
        globalSeq: 1,
        streamId: 'account-x',
        version: 1,
        type: 'AccountOpened',
        payload: { accountId: 'x', owner: 'Alice', initialDeposit: 1000 },
        metadata: { correlation_id: 'c1', causation_id: 'c1' },
        createdAt: '2026-05-21T12:00:00.000Z',
      },
    ];
    fakePrimaryTip = 1;

    const puller = createPuller({
      primaryUrl: fakePrimaryUrl,
      pollMs: 0,
      deps: defaultDeps(),
    });
    await puller.tickOnce();

    // tick the local projector manually instead of starting the loop
    await tickOnce();

    const { rows } = await getPool().query(
      `SELECT account_id, owner, balance::int, status FROM account_projection WHERE account_id = 'x'`,
    );
    expect(rows[0]).toMatchObject({
      account_id: 'x',
      owner: 'Alice',
      balance: 1000,
      status: 'open',
    });
  });

  it('a second tick is a no-op when nothing new is on the primary', async () => {
    fakePrimaryEvents = [
      {
        globalSeq: 1,
        streamId: 'account-x',
        version: 1,
        type: 'AccountOpened',
        payload: { accountId: 'x', owner: 'Alice', initialDeposit: 0 },
        metadata: { correlation_id: 'c1', causation_id: 'c1' },
        createdAt: '2026-05-21T12:00:00.000Z',
      },
    ];
    fakePrimaryTip = 1;

    const puller = createPuller({
      primaryUrl: fakePrimaryUrl,
      pollMs: 0,
      deps: defaultDeps(),
    });
    await puller.tickOnce();
    await puller.tickOnce();

    const { rows } = await getPool().query(`SELECT COUNT(*)::int AS n FROM events`);
    expect(rows[0].n).toBe(1);
  });
});
