import type { StoredEvent } from '../../infra/eventStore.js';
import type { Tx } from '../../infra/db.js';

export async function accountProjector(tx: Tx, event: StoredEvent): Promise<void> {
  const p = event.payload as Record<string, any>;
  switch (event.type) {
    case 'AccountOpened':
      await tx.query(
        `INSERT INTO account_projection
           (account_id, owner, balance, status, version, opened_at)
         VALUES ($1, $2, $3, 'open', $4, $5)
         ON CONFLICT (account_id) DO NOTHING`,
        [p.accountId, p.owner, p.initialDeposit, event.version, event.createdAt],
      );
      break;
    case 'MoneyDeposited':
      await tx.query(
        `UPDATE account_projection
            SET balance = balance + $1, version = $2
          WHERE account_id = $3`,
        [p.amount, event.version, p.accountId],
      );
      break;
    case 'MoneyWithdrawn':
      await tx.query(
        `UPDATE account_projection
            SET balance = balance - $1, version = $2
          WHERE account_id = $3`,
        [p.amount, event.version, p.accountId],
      );
      break;
    case 'AccountClosed':
      await tx.query(
        `UPDATE account_projection
            SET status = 'closed', version = $1, closed_at = $2
          WHERE account_id = $3`,
        [event.version, event.createdAt, p.accountId],
      );
      break;
  }
}
