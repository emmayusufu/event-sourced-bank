import { getPool, type Tx } from './db.js';
import { ConcurrencyError } from '../shared/errors.js';

export type StoredEvent = {
  globalSeq: number;
  streamId: string;
  version: number;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type NewEvent = {
  type: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type AppendResult = { version: number; globalSeq: number };

function rowToEvent(r: any): StoredEvent {
  return {
    globalSeq: Number(r.global_seq),
    streamId: r.stream_id,
    version: r.version,
    type: r.type,
    payload: r.payload,
    metadata: r.metadata,
    createdAt: r.created_at,
  };
}

export async function readStream(streamId: string): Promise<StoredEvent[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM events WHERE stream_id = $1 ORDER BY version`,
    [streamId]
  );
  return rows.map(rowToEvent);
}

export async function readAfter(seq: number, limit = 100): Promise<StoredEvent[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM events WHERE global_seq > $1 ORDER BY global_seq LIMIT $2`,
    [seq, limit]
  );
  return rows.map(rowToEvent);
}

export async function appendToStream(
  streamId: string,
  expectedVersion: number,
  events: NewEvent[],
  tx?: Tx,
): Promise<AppendResult> {
  if (events.length === 0) return { version: expectedVersion, globalSeq: 0 };
  const exec = tx ?? getPool();

  let nextVersion = expectedVersion + 1;
  let lastGlobalSeq = 0;
  for (const event of events) {
    try {
      const r = await exec.query(
        `INSERT INTO events (stream_id, version, type, payload, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING global_seq`,
        [streamId, nextVersion, event.type, event.payload, event.metadata ?? {}]
      );
      lastGlobalSeq = Number(r.rows[0].global_seq);
      nextVersion++;
    } catch (err: any) {
      if (err.code === '23505') {
        const { rows } = await getPool().query(
          `SELECT MAX(version) as v FROM events WHERE stream_id = $1`,
          [streamId]
        );
        throw new ConcurrencyError(expectedVersion, Number(rows[0]?.v ?? 0));
      }
      throw err;
    }
  }
  return { version: nextVersion - 1, globalSeq: lastGlobalSeq };
}
