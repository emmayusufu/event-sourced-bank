import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from './db.js';

export async function runMigrations(
  dir = `migrations/${process.env.ROLE === 'follower' ? 'follower' : 'primary'}`,
) {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [
      file,
    ]);
    if (rows.length > 0) continue;

    const sql = readFileSync(join(dir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      console.log(`migrated: ${file}`);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* preserve original error */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
