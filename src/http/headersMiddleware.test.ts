import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { replicationHeaders } from './headersMiddleware.js';
import { _setPullerStateForTesting } from '../replication/puller.js';

vi.mock('../projector/loop.js', () => ({
  tipSeq: vi.fn(async () => 42),
}));

function buildApp() {
  const app = express();
  app.use(replicationHeaders);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('replicationHeaders middleware', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    _setPullerStateForTesting(null);
  });
  afterEach(() => {
    _setPullerStateForTesting(null);
  });

  it('sets X-Role=primary and X-Local-Seq=X-Primary-Tip when ROLE is unset', async () => {
    vi.stubEnv('ROLE', '');
    const r = await request(buildApp()).get('/ping');
    expect(r.headers['x-role']).toBe('primary');
    expect(r.headers['x-local-seq']).toBe('42');
    expect(r.headers['x-primary-tip']).toBe('42');
    expect(r.headers['x-replica-lag-events']).toBeUndefined();
  });

  it('sets X-Role=follower and X-Replica-Lag-Events when ROLE=follower', async () => {
    vi.stubEnv('ROLE', 'follower');
    _setPullerStateForTesting({
      observedPrimaryTip: 50,
      lastPolledAt: new Date(),
      lastError: null,
    });
    const r = await request(buildApp()).get('/ping');
    expect(r.headers['x-role']).toBe('follower');
    expect(r.headers['x-local-seq']).toBe('42');
    expect(r.headers['x-primary-tip']).toBe('50');
    expect(r.headers['x-replica-lag-events']).toBe('8');
  });
});
