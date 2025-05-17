import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { getPool } from '../infra/db.js';
import { ValidationError } from '../shared/errors.js';

export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize((v as any)[k])).join(',') + '}';
}

export function hashBody(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}

export const idempotency: RequestHandler = async (req, res, next) => {
  if (req.method !== 'POST') return next();
  const key = req.header('Idempotency-Key');
  if (!key) return next();

  const route = `${req.method} ${req.path}`;
  const hash = hashBody(req.body);

  try {
    const claim = await getPool().query(
      `INSERT INTO idempotency_keys (key, route, request_hash, status_code, response_body)
       VALUES ($1, $2, $3, 0, '{}'::jsonb)
       ON CONFLICT (key, route) DO NOTHING
       RETURNING key`,
      [key, route, hash],
    );

    if (claim.rows.length === 0) {
      const { rows } = await getPool().query(
        `SELECT request_hash, status_code, response_body FROM idempotency_keys
         WHERE key = $1 AND route = $2`,
        [key, route],
      );
      const row = rows[0];
      if (!row) return next();
      if (row.request_hash !== hash) {
        return next(new ValidationError('Idempotency-Key reused with a different request body'));
      }
      if (row.status_code === 0) {
        res.status(409).json({
          error: 'idempotency_in_flight',
          message: 'a request with this key is already in flight',
        });
        return;
      }
      res.setHeader('Idempotent-Replay', 'true');
      res.status(row.status_code).json(row.response_body);
      return;
    }
  } catch (err) {
    return next(err);
  }

  const originalJson = res.json.bind(res);
  let captured: { status: number; body: unknown } | null = null;
  res.json = (body: unknown) => {
    if (!captured) captured = { status: res.statusCode, body };
    return originalJson(body);
  };

  res.on('finish', () => {
    const finalize =
      captured && captured.status < 500
        ? getPool().query(
            `UPDATE idempotency_keys
             SET status_code = $1, response_body = $2
           WHERE key = $3 AND route = $4`,
            [captured.status, captured.body, key, route],
          )
        : getPool().query(
            `DELETE FROM idempotency_keys
           WHERE key = $1 AND route = $2 AND status_code = 0`,
            [key, route],
          );
    finalize.catch(err => console.error('idempotency finalize failed:', err));
  });

  next();
};
