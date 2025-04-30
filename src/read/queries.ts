import { getPool } from '../infra/db.js';

export type AccountView = {
  accountId: string;
  owner: string;
  balance: number;
  status: string;
  version: number;
  openedAt: Date;
  closedAt: Date | null;
};

export type TransactionView = {
  type: string;
  amount: number;
  balanceAfter: number;
  relatedAccount: string | null;
  occurredAt: Date;
};

function rowToAccount(r: any): AccountView {
  return {
    accountId: r.account_id,
    owner: r.owner,
    balance: Number(r.balance),
    status: r.status,
    version: r.version,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
  };
}

export async function getAccount(id: string): Promise<AccountView | null> {
  const { rows } = await getPool().query(
    `SELECT * FROM account_projection WHERE account_id = $1`,
    [id],
  );
  return rows[0] ? rowToAccount(rows[0]) : null;
}

export async function listOpenAccounts(): Promise<AccountView[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM account_projection WHERE status = 'open' ORDER BY opened_at DESC`,
  );
  return rows.map(rowToAccount);
}

export async function getTransactions(accountId: string): Promise<TransactionView[]> {
  const { rows } = await getPool().query(
    `SELECT type, amount, balance_after, related_account, occurred_at
       FROM transaction_projection
      WHERE account_id = $1
      ORDER BY occurred_at DESC, id DESC
      LIMIT 100`,
    [accountId],
  );
  return rows.map(r => ({
    type: r.type,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    relatedAccount: r.related_account,
    occurredAt: r.occurred_at,
  }));
}
