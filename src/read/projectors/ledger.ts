import type { StoredEvent } from '../../infra/eventStore.js';
import type { Tx } from '../../infra/db.js';

const CASH_IN = 'system:cash-in';
const CASH_OUT = 'system:cash-out';
const SUSPENSE = 'system:transfer-suspense';

type Entry = {
  account: string;
  direction: 'debit' | 'credit';
  amount: number;
};

async function writePair(
  tx: Tx,
  event: StoredEvent,
  group: string,
  entries: [Entry, Entry],
): Promise<void> {
  for (const e of entries) {
    await tx.query(
      `INSERT INTO ledger_entries
         (entry_group, account_id, direction, amount, occurred_at, event_seq)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_seq, account_id, direction) DO NOTHING`,
      [group, e.account, e.direction, e.amount, event.createdAt, event.globalSeq],
    );
  }
}

export async function ledgerProjector(tx: Tx, event: StoredEvent): Promise<void> {
  const p = event.payload as Record<string, any>;
  const meta = event.metadata as Record<string, any>;

  switch (event.type) {
    case 'AccountOpened': {
      if (!p.initialDeposit) return;
      await writePair(tx, event, `account-open-${p.accountId}`, [
        { account: CASH_IN, direction: 'debit', amount: p.initialDeposit },
        { account: p.accountId, direction: 'credit', amount: p.initialDeposit },
      ]);
      break;
    }
    case 'MoneyDeposited': {
      if (meta.transferId) {
        const group = meta.refund
          ? `transfer-${meta.transferId}-refund`
          : `transfer-${meta.transferId}-credit`;
        await writePair(tx, event, group, [
          { account: SUSPENSE, direction: 'debit', amount: p.amount },
          { account: p.accountId, direction: 'credit', amount: p.amount },
        ]);
      } else {
        await writePair(tx, event, `deposit-${event.globalSeq}`, [
          { account: CASH_IN, direction: 'debit', amount: p.amount },
          { account: p.accountId, direction: 'credit', amount: p.amount },
        ]);
      }
      break;
    }
    case 'MoneyWithdrawn': {
      if (meta.transferId) {
        await writePair(tx, event, `transfer-${meta.transferId}-debit`, [
          { account: p.accountId, direction: 'debit', amount: p.amount },
          { account: SUSPENSE, direction: 'credit', amount: p.amount },
        ]);
      } else {
        await writePair(tx, event, `withdraw-${event.globalSeq}`, [
          { account: p.accountId, direction: 'debit', amount: p.amount },
          { account: CASH_OUT, direction: 'credit', amount: p.amount },
        ]);
      }
      break;
    }
  }
}
