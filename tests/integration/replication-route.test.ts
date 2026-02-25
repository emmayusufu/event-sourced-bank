import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../../src/http/server.js';
import { resetDb, stopTestProjector } from './helpers.js';

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

describe('GET /admin/replication on primary', () => {
  it('returns role=primary with lagEvents=0', async () => {
    const r = await request(app).get('/admin/replication').expect(200);
    expect(r.body).toMatchObject({
      role: 'primary',
      lagEvents: 0,
      lastPolledAt: null,
      lastError: null,
    });
    expect(typeof r.body.localSeq).toBe('number');
    expect(r.body.primaryTip).toBe(r.body.localSeq);
  });
});
