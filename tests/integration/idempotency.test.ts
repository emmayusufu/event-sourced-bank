import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { v4 as uuid } from 'uuid';
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

describe('idempotency middleware (integration)', () => {
  it('returns the original response on retry with the same key', async () => {
    const key = uuid();
    const body = { owner: 'Carol', initialDeposit: 500 };

    const first = await request(app)
      .post('/accounts')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    const second = await request(app)
      .post('/accounts')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.accountId).toBe(first.body.accountId);
  });

  it('rejects a different body under the same key', async () => {
    const key = uuid();

    await request(app)
      .post('/accounts')
      .set('Idempotency-Key', key)
      .send({ owner: 'Carol', initialDeposit: 500 })
      .expect(201);

    const conflict = await request(app)
      .post('/accounts')
      .set('Idempotency-Key', key)
      .send({ owner: 'Dave', initialDeposit: 500 })
      .expect(400);

    expect(conflict.body.error).toBe('validation');
  });
});
