import { getPool } from '../infra/db.js';

export type PullerState = {
  observedPrimaryTip: number;
  lastPolledAt: Date | null;
  lastError: string | null;
};

export type PullerRow = {
  globalSeq: number;
  streamId: string;
  version: number;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type FetchEventsResult = {
  rows: PullerRow[];
  primaryTip: number;
};

export type PullerDeps = {
  selectLocalMax: () => Promise<number>;
  insertBatch: (rows: PullerRow[]) => Promise<void>;
  fetchEvents: (url: string) => Promise<FetchEventsResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

let liveState: PullerState | null = null;

export function getPullerState(): PullerState | null {
  return liveState;
}

export function _setPullerStateForTesting(s: PullerState | null): void {
  liveState = s;
}

export function createPuller({
  primaryUrl,
  pollMs,
  deps,
}: {
  primaryUrl: string;
  pollMs: number;
  deps: PullerDeps;
}) {
  const state: PullerState = {
    observedPrimaryTip: 0,
    lastPolledAt: null,
    lastError: null,
  };

  async function tickOnce(): Promise<void> {
    state.lastPolledAt = deps.now();
    try {
      const localMax = await deps.selectLocalMax();
      const url = `${primaryUrl}/admin/events?after=${localMax}&limit=500`;
      const result = await deps.fetchEvents(url);
      state.observedPrimaryTip = result.primaryTip;
      if (result.rows.length > 0) {
        await deps.insertBatch(result.rows);
      }
      state.lastError = null;
    } catch (err: any) {
      state.lastError = String(err?.message ?? err);
    }
  }

  return {
    tickOnce,
    getState: (): PullerState => ({ ...state }),
    syncToLiveState: () => {
      liveState = state;
    },
  };
}

export function defaultDeps(): PullerDeps {
  return {
    selectLocalMax: async () => {
      const { rows } = await getPool().query(
        `SELECT COALESCE(MAX(global_seq), 0) AS s FROM events`,
      );
      return Number(rows[0]?.s ?? 0);
    },
    insertBatch: async rows => {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const r of rows) {
          await client.query(
            `INSERT INTO events
               (global_seq, stream_id, version, type, payload, metadata, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (global_seq) DO NOTHING`,
            [r.globalSeq, r.streamId, r.version, r.type, r.payload, r.metadata, r.createdAt],
          );
        }
        await client.query('COMMIT');
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
    },
    fetchEvents: async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`primary fetch ${res.status}`);
      const tipHeader = res.headers.get('x-primary-tip');
      const primaryTip = tipHeader == null ? 0 : Number(tipHeader);
      const rows = (await res.json()) as PullerRow[];
      return { rows, primaryTip };
    },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    now: () => new Date(),
  };
}

let runHandle: { stop: () => void } | null = null;

export function startPuller({
  primaryUrl,
  pollMs,
  deps = defaultDeps(),
}: {
  primaryUrl: string;
  pollMs: number;
  deps?: PullerDeps;
}): { stop: () => Promise<void> } {
  const puller = createPuller({ primaryUrl, pollMs, deps });
  puller.syncToLiveState();
  let running = true;
  let stopped = false;
  const loop = async () => {
    let backoff = 500;
    while (running) {
      await puller.tickOnce();
      const state = puller.getState();
      if (state.lastError) {
        await deps.sleep(backoff);
        backoff = Math.min(backoff * 2, 5000);
      } else {
        backoff = 500;
        await deps.sleep(pollMs);
      }
    }
    stopped = true;
  };
  loop().catch(err => {
    console.error('puller loop crashed:', err);
    stopped = true;
  });
  runHandle = {
    stop: () => {
      running = false;
    },
  };
  return {
    async stop() {
      running = false;
      while (!stopped) await new Promise(r => setTimeout(r, 25));
      liveState = null;
      runHandle = null;
    },
  };
}

export function _isPullerRunning(): boolean {
  return runHandle !== null;
}
