import { appendToStream } from '../../infra/eventStore.js';
import { ValidationError } from '../../shared/errors.js';
import { transferStreamId } from './events.js';
import type { RequestTransferCommand } from './commands.js';

export async function handleRequestTransfer(cmd: RequestTransferCommand) {
  if (cmd.amount <= 0) throw new ValidationError('amount must be > 0');
  if (cmd.fromId === cmd.toId) throw new ValidationError('cannot transfer to same account');

  const r = await appendToStream(transferStreamId(cmd.transferId), 0, [
    {
      type: 'TransferRequested',
      payload: {
        transferId: cmd.transferId,
        fromId: cmd.fromId,
        toId: cmd.toId,
        amount: cmd.amount,
      },
    },
  ]);
  return { transferId: cmd.transferId, status: 'requested', globalSeq: r.globalSeq };
}
