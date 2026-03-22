import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readOnlyOnFollower } from './readOnlyMiddleware.js';

function buildTinyApp() {
  const app = express();
  app.use(express.json());
  app.use(readOnlyOnFollower);
  app.get('/get', (_req, res) => res.json({ ok: true }));
  app.post('/post', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('readOnlyOnFollower', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes everything through when ROLE is unset (primary)', async () => {
    vi.stubEnv('ROLE', '');
    const app = buildTinyApp();
    await request(app).get('/get').expect(200);
    await request(app).post('/post').expect(200);
  });

  it('lets GETs through on follower', async () => {
    vi.stubEnv('ROLE', 'follower');
    const app = buildTinyApp();
    await request(app).get('/get').expect(200);
  });

  it('returns 403 with primaryUrl on POST when ROLE=follower', async () => {
    vi.stubEnv('ROLE', 'follower');
    vi.stubEnv('PRIMARY_URL', 'http://primary:3000');
    const app = buildTinyApp();
    const r = await request(app).post('/post').expect(403);
    expect(r.body).toEqual({
      error: 'read-only replica',
      primaryUrl: 'http://primary:3000',
    });
  });
});
