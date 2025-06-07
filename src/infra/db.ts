import pg from 'pg';

export type Tx = pg.PoolClient;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      allowExitOnIdle: true,
    });
    pool.on('error', err => {
      console.error('pg pool error:', err.message);
    });
  }
  return pool;
}

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
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
