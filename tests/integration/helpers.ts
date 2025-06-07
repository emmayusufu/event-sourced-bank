import { getPool } from '../../src/infra/db.js';
import { startProjector, stopProjector } from '../../src/projector/loop.js';

let projectorRunning = false;

export function startTestProjector() {
  if (!projectorRunning) {
    startProjector(50);
    projectorRunning = true;
  }
}

export async function stopTestProjector() {
  if (projectorRunning) {
    await stopProjector();
    projectorRunning = false;
  }
}

export async function resetDb() {
  await stopTestProjector();
  const pool = getPool();
  await pool.query(`DELETE FROM idempotency_keys`);
  await pool.query(`DELETE FROM ledger_entries`);
  await pool.query(`DELETE FROM transaction_projection`);
  await pool.query(`DELETE FROM account_projection`);
  await pool.query(`DELETE FROM events`);
  await pool.query(`UPDATE projector_checkpoint SET last_seq = 0 WHERE name = 'main'`);
  startTestProjector();
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 10_000,
  intervalMs = 25,
): Promise<T> {
  const start = Date.now();
  let last: unknown = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last as T;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms; last value=${JSON.stringify(last)}`);
}
