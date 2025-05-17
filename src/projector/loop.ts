import { getPool, withTx, type Tx } from '../infra/db.js';
import { readAfter, type StoredEvent } from '../infra/eventStore.js';
import { accountProjector } from '../read/projectors/account.js';
import { transactionProjector } from '../read/projectors/transaction.js';
import { ledgerProjector } from '../read/projectors/ledger.js';
import { transferProcessManager } from '../process/transfer.js';

export type Handler = (tx: Tx, event: StoredEvent) => Promise<void>;

const handlers: Handler[] = [
  accountProjector,
  transactionProjector,
  ledgerProjector,
  transferProcessManager,
];

async function getCheckpoint(tx: Tx): Promise<number> {
  const { rows } = await tx.query(
    `SELECT last_seq FROM projector_checkpoint WHERE name = 'main' FOR UPDATE`,
  );
  return Number(rows[0]?.last_seq ?? 0);
}

async function setCheckpoint(tx: Tx, seq: number): Promise<void> {
  await tx.query(
    `UPDATE projector_checkpoint SET last_seq = $1 WHERE name = 'main'`,
    [seq],
  );
}

let running = false;
let stopped = false;

export async function tickOnce(): Promise<number> {
  return withTx(async tx => {
    const cp = await getCheckpoint(tx);
    const events = await readAfter(cp, 100);
    if (events.length === 0) return 0;

    for (const event of events) {
      for (const h of handlers) {
        await h(tx, event);
      }
    }
    await setCheckpoint(tx, events[events.length - 1]!.globalSeq);
    return events.length;
  });
}

export function startProjector(intervalMs = 200) {
  running = true;
  stopped = false;
  const loop = async () => {
    while (running) {
      try {
        const n = await tickOnce();
        if (n === 0) await new Promise(r => setTimeout(r, intervalMs));
      } catch (err) {
        console.error('projector tick failed:', err);
        await new Promise(r => setTimeout(r, intervalMs));
      }
    }
    stopped = true;
  };
  loop();
}

export async function stopProjector(): Promise<void> {
  running = false;
  while (!stopped) await new Promise(r => setTimeout(r, 50));
}

export async function currentCheckpoint(): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT last_seq FROM projector_checkpoint WHERE name = 'main'`,
  );
  return Number(rows[0]?.last_seq ?? 0);
}

export async function tipSeq(): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COALESCE(MAX(global_seq), 0) AS s FROM events`,
  );
  return Number(rows[0]?.s ?? 0);
}

export async function waitForCheckpoint(target: number, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await currentCheckpoint() >= target) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}
