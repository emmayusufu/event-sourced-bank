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
  const { rows } = await getPool().query(`SELECT * FROM account_projection WHERE account_id = $1`, [
    id,
  ]);
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

export type LedgerEntryView = {
  entryGroup: string;
  direction: 'debit' | 'credit';
  amount: number;
  occurredAt: Date;
  eventSeq: number;
};

export async function getLedger(accountId: string, limit = 100): Promise<LedgerEntryView[]> {
  const { rows } = await getPool().query(
    `SELECT entry_group, direction, amount, occurred_at, event_seq
       FROM ledger_entries
      WHERE account_id = $1
      ORDER BY occurred_at DESC, id DESC
      LIMIT $2`,
    [accountId, limit],
  );
  return rows.map(r => ({
    entryGroup: r.entry_group,
    direction: r.direction,
    amount: Number(r.amount),
    occurredAt: r.occurred_at,
    eventSeq: Number(r.event_seq),
  }));
}

export type TrialBalanceRow = {
  accountId: string;
  debits: number;
  credits: number;
  net: number;
};

export async function trialBalance(): Promise<TrialBalanceRow[]> {
  const { rows } = await getPool().query(
    `SELECT account_id,
            SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END) AS debits,
            SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END) AS credits
       FROM ledger_entries
      GROUP BY account_id
      ORDER BY account_id`,
  );
  return rows.map(r => ({
    accountId: r.account_id,
    debits: Number(r.debits),
    credits: Number(r.credits),
    net: Number(r.credits) - Number(r.debits),
  }));
}

export type Invariants = {
  globalNet: number;
  unbalancedGroups: { entryGroup: string; net: number }[];
  reconciliation: { accountId: string; projection: number; ledger: number; drift: number }[];
};

export async function checkInvariants(): Promise<Invariants> {
  const pool = getPool();

  const { rows: globalRows } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END), 0) AS net
       FROM ledger_entries`,
  );
  const globalNet = Number(globalRows[0].net);

  const { rows: groupRows } = await pool.query(
    `SELECT entry_group,
            SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END) AS net
       FROM ledger_entries
      GROUP BY entry_group
     HAVING SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END) <> 0`,
  );

  const { rows: reconRows } = await pool.query(
    `SELECT a.account_id,
            a.balance AS projection_balance,
            COALESCE((
              SELECT SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END)
                FROM ledger_entries WHERE account_id = a.account_id
            ), 0) AS ledger_balance
       FROM account_projection a`,
  );

  return {
    globalNet,
    unbalancedGroups: groupRows.map(r => ({
      entryGroup: r.entry_group,
      net: Number(r.net),
    })),
    reconciliation: reconRows
      .map(r => ({
        accountId: r.account_id,
        projection: Number(r.projection_balance),
        ledger: Number(r.ledger_balance),
        drift: Number(r.projection_balance) - Number(r.ledger_balance),
      }))
      .filter(r => r.drift !== 0),
  };
}
