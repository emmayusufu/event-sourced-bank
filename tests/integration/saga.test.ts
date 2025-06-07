import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../../src/http/server.js';
import { resetDb, stopTestProjector, waitFor } from './helpers.js';

let app: Express;

beforeAll(() => {
  app = buildApp();
});

afterAll(async () => {
  await stopTestProjector();
});

beforeEach(async () => {
  await resetDb();
});

async function openAccount(owner: string, initialDeposit: number): Promise<string> {
  const r = await request(app)
    .post('/accounts?wait=true')
    .send({ owner, initialDeposit })
    .expect(201);
  return r.body.accountId;
}

describe('transfer saga (integration)', () => {
  it('completes a successful transfer end-to-end', async () => {
    const A = await openAccount('Alice', 10_000);
    const B = await openAccount('Bob', 0);

    const transferRes = await request(app)
      .post('/transfers')
      .send({ fromId: A, toId: B, amount: 2_500 })
      .expect(202);
    const T: string = transferRes.body.transferId;

    const completed = await waitFor(async () => {
      const r = await request(app).get(`/transfers/${T}`);
      return r.body.status === 'completed' ? r.body : null;
    });
    expect(completed).toMatchObject({ status: 'completed' });

    const aFinal = await request(app).get(`/accounts/${A}`);
    const bFinal = await request(app).get(`/accounts/${B}`);
    expect(aFinal.body.balance).toBe(7_500);
    expect(bFinal.body.balance).toBe(2_500);

    const inv = await request(app).get('/admin/ledger/invariants');
    expect(inv.body.healthy).toBe(true);
    expect(inv.body.globalNet).toBe(0);
  });

  it('refunds the sender when the deposit leg fails (recipient closed)', async () => {
    const A = await openAccount('Alice', 10_000);
    const B = await openAccount('Bob', 0);

    await request(app)
      .post(`/accounts/${B}/close?wait=true`)
      .send({ expectedVersion: 1 })
      .expect(200);

    const transferRes = await request(app)
      .post('/transfers')
      .send({ fromId: A, toId: B, amount: 1_000 })
      .expect(202);
    const T: string = transferRes.body.transferId;

    const failed = await waitFor(async () => {
      const r = await request(app).get(`/transfers/${T}`);
      return r.body.status === 'failed' ? r.body : null;
    });
    expect(failed).toMatchObject({ status: 'failed', refunded: true });

    const aFinal = await request(app).get(`/accounts/${A}`);
    expect(aFinal.body.balance).toBe(10_000);

    const inv = await request(app).get('/admin/ledger/invariants');
    expect(inv.body.healthy).toBe(true);
    expect(inv.body.globalNet).toBe(0);
  });
});
