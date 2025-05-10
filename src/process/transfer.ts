import { appendToStream, readStream, type StoredEvent } from '../infra/eventStore.js';
import type { Tx } from '../infra/db.js';
import { transferStreamId } from '../write/transfer/events.js';
import { rehydrateTransfer } from '../write/transfer/state.js';
import { accountStreamId } from '../write/account/events.js';
import { rehydrateAccount } from '../write/account/state.js';
import { handleDeposit, handleWithdraw } from '../write/account/handlers.js';
import { BusinessRuleError, ConcurrencyError, NotFoundError } from '../shared/errors.js';

async function appendTransferEvent(transferId: string, eventType: string, payload: Record<string, unknown>) {
  const stream = transferStreamId(transferId);
  const events = await readStream(stream);
  const state = rehydrateTransfer(events);
  const expected = state?.version ?? 0;
  await appendToStream(stream, expected, [{ type: eventType, payload }]);
}

async function currentAccountVersion(accountId: string): Promise<number> {
  const events = await readStream(accountStreamId(accountId));
  const state = rehydrateAccount(events);
  return state?.version ?? 0;
}

export async function transferProcessManager(_tx: Tx, event: StoredEvent): Promise<void> {
  const p = event.payload as Record<string, any>;
  const meta = event.metadata as Record<string, any>;

  switch (event.type) {
    case 'TransferRequested': {
      const { transferId, fromId, toId, amount } = p;
      const transferEvents = await readStream(transferStreamId(transferId));
      const transfer = rehydrateTransfer(transferEvents);
      if (transfer && transfer.status !== 'requested') return;
      try {
        const version = await currentAccountVersion(fromId);
        await handleWithdraw({
          type: 'Withdraw',
          accountId: fromId,
          amount,
          expectedVersion: version,
          metadata: { transferId, transferToId: toId },
        });
      } catch (err) {
        if (err instanceof BusinessRuleError ||
            err instanceof NotFoundError ||
            err instanceof ConcurrencyError) {
          await appendTransferEvent(transferId, 'TransferFailed', {
            transferId,
            reason: err.message,
            refunded: false,
          });
        } else {
          throw err;
        }
      }
      break;
    }

    case 'MoneyWithdrawn': {
      const transferId = meta.transferId;
      if (!transferId) return;

      const transferEvents = await readStream(transferStreamId(transferId));
      const transfer = rehydrateTransfer(transferEvents);
      if (!transfer || transfer.status !== 'requested') return;

      await appendTransferEvent(transferId, 'TransferDebited', { transferId });

      try {
        const version = await currentAccountVersion(transfer.toId);
        await handleDeposit({
          type: 'Deposit',
          accountId: transfer.toId,
          amount: transfer.amount,
          expectedVersion: version,
          metadata: { transferId, transferFromId: transfer.fromId },
        });
      } catch (err) {
        if (err instanceof BusinessRuleError ||
            err instanceof NotFoundError ||
            err instanceof ConcurrencyError) {
          await refund(transfer.fromId, transfer.amount, transferId);
          await appendTransferEvent(transferId, 'TransferFailed', {
            transferId,
            reason: err.message,
            refunded: true,
          });
        } else {
          throw err;
        }
      }
      break;
    }

    case 'MoneyDeposited': {
      const transferId = meta.transferId;
      if (!transferId) return;

      const transferEvents = await readStream(transferStreamId(transferId));
      const transfer = rehydrateTransfer(transferEvents);
      if (!transfer || transfer.status !== 'debited') return;

      await appendTransferEvent(transferId, 'TransferCredited', { transferId });
      await appendTransferEvent(transferId, 'TransferCompleted', { transferId });
      break;
    }
  }
}

async function refund(accountId: string, amount: number, transferId: string) {
  const version = await currentAccountVersion(accountId);
  await handleDeposit({
    type: 'Deposit',
    accountId,
    amount,
    expectedVersion: version,
    metadata: { transferId, refund: true },
  });
}
