import type { StoredEvent } from '../../infra/eventStore.js';
import type { Tx } from '../../infra/db.js';

async function getCurrentBalance(tx: Tx, accountId: string): Promise<number> {
  const { rows } = await tx.query(`SELECT balance FROM account_projection WHERE account_id = $1`, [
    accountId,
  ]);
  return Number(rows[0]?.balance ?? 0);
}

export async function transactionProjector(tx: Tx, event: StoredEvent): Promise<void> {
  const p = event.payload as Record<string, any>;
  const meta = event.metadata as Record<string, any>;

  let type: string | null = null;
  let amount = 0;
  let related: string | null = null;

  switch (event.type) {
    case 'AccountOpened':
      if (!p.initialDeposit) return;
      type = 'deposit';
      amount = p.initialDeposit;
      break;
    case 'MoneyDeposited':
      type = meta.transferId ? 'transfer-in' : 'deposit';
      amount = p.amount;
      related = meta.transferFromId ?? null;
      break;
    case 'MoneyWithdrawn':
      type = meta.transferId ? 'transfer-out' : 'withdrawal';
      amount = p.amount;
      related = meta.transferToId ?? null;
      break;
    default:
      return;
  }

  const balanceAfter = await getCurrentBalance(tx, p.accountId);

  await tx.query(
    `INSERT INTO transaction_projection
       (account_id, type, amount, balance_after, related_account, occurred_at, event_seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_seq) DO NOTHING`,
    [p.accountId, type, amount, balanceAfter, related, event.createdAt, event.globalSeq],
  );
}
