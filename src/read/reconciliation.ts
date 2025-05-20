import { getPool } from '../infra/db.js';
import { type StoredEvent } from '../infra/eventStore.js';
import { applyAccountEvent, type AccountState } from '../write/account/state.js';

export type StuckTransfer = {
  transferId: string;
  status: 'requested' | 'debited';
  fromId: string;
  toId: string;
  amount: number;
  lastEventAt: Date;
  ageSeconds: number;
};

export async function findStuckTransfers(thresholdSeconds: number): Promise<StuckTransfer[]> {
  const { rows } = await getPool().query(
    `WITH latest AS (
       SELECT DISTINCT ON (stream_id)
              stream_id, type, payload, created_at
         FROM events
        WHERE stream_id LIKE 'transfer-%'
        ORDER BY stream_id, version DESC
     ),
     started AS (
       SELECT stream_id,
              (payload->>'fromId') AS from_id,
              (payload->>'toId')   AS to_id,
              (payload->>'amount')::bigint AS amount
         FROM events
        WHERE type = 'TransferRequested'
     )
     SELECT l.stream_id,
            l.type,
            l.created_at,
            s.from_id,
            s.to_id,
            s.amount,
            EXTRACT(EPOCH FROM (NOW() - l.created_at))::int AS age_seconds
       FROM latest l
       JOIN started s USING (stream_id)
      WHERE l.type IN ('TransferRequested', 'TransferDebited')
        AND l.created_at < NOW() - ($1 * INTERVAL '1 second')
      ORDER BY l.created_at`,
    [thresholdSeconds],
  );

  return rows.map(r => ({
    transferId: r.stream_id.replace('transfer-', ''),
    status: r.type === 'TransferRequested' ? 'requested' : 'debited',
    fromId: r.from_id,
    toId: r.to_id,
    amount: Number(r.amount),
    lastEventAt: r.created_at,
    ageSeconds: r.age_seconds,
  }));
}

export type AccountSnapshot = {
  balance: number;
  status: string;
  version: number;
};

export type AccountDrift = {
  accountId: string;
  projection: AccountSnapshot | null;
  replay: AccountSnapshot | null;
};

export type ReplayCheckResult = {
  healthy: boolean;
  accountsChecked: number;
  drift: AccountDrift[];
};

export function diffReplayVsProjection(
  replayed: Map<string, AccountSnapshot>,
  projection: Map<string, AccountSnapshot>,
): AccountDrift[] {
  const drift: AccountDrift[] = [];

  for (const [accountId, replay] of replayed) {
    const proj = projection.get(accountId);
    if (!proj) {
      drift.push({ accountId, projection: null, replay });
      continue;
    }
    if (
      proj.balance !== replay.balance ||
      proj.status !== replay.status ||
      proj.version !== replay.version
    ) {
      drift.push({ accountId, projection: proj, replay });
    }
  }

  for (const [accountId, proj] of projection) {
    if (!replayed.has(accountId)) {
      drift.push({ accountId, projection: proj, replay: null });
    }
  }

  return drift;
}

function rowToStoredEvent(r: any): StoredEvent {
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

export async function replayCheck(): Promise<ReplayCheckResult> {
  const pool = getPool();

  const { rows: eventRows } = await pool.query(
    `SELECT * FROM events
      WHERE stream_id LIKE 'account-%'
      ORDER BY stream_id, version`,
  );
  const events = eventRows.map(rowToStoredEvent);

  const byStream = new Map<string, StoredEvent[]>();
  for (const e of events) {
    let bucket = byStream.get(e.streamId);
    if (!bucket) {
      bucket = [];
      byStream.set(e.streamId, bucket);
    }
    bucket.push(e);
  }

  const replayed = new Map<string, AccountState>();
  for (const [streamId, streamEvents] of byStream) {
    const state = streamEvents.reduce<AccountState | null>((s, e) => applyAccountEvent(s, e), null);
    if (state) replayed.set(streamId.replace('account-', ''), state);
  }

  const replayedSnapshots = new Map<string, AccountSnapshot>(
    Array.from(replayed.entries()).map(([id, s]) => [
      id,
      { balance: s.balance, status: s.status, version: s.version },
    ]),
  );

  const { rows: projectedRows } = await pool.query(`SELECT * FROM account_projection`);
  const projection = new Map<string, AccountSnapshot>(
    projectedRows.map(p => [
      p.account_id,
      { balance: Number(p.balance), status: p.status, version: Number(p.version) },
    ]),
  );

  const drift = diffReplayVsProjection(replayedSnapshots, projection);

  return {
    healthy: drift.length === 0,
    accountsChecked: replayedSnapshots.size,
    drift,
  };
}
