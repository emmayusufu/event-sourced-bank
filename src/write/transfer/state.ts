import type { StoredEvent } from '../../infra/eventStore.js';

export type TransferStatus = 'requested' | 'debited' | 'credited' | 'completed' | 'failed';

export type TransferState = {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  status: TransferStatus;
  reason: string | null;
  refunded: boolean;
  version: number;
};

export function applyTransferEvent(
  state: TransferState | null,
  stored: StoredEvent,
): TransferState {
  const p = stored.payload as Record<string, any>;
  switch (stored.type) {
    case 'TransferRequested':
      return {
        id: p.transferId,
        fromId: p.fromId,
        toId: p.toId,
        amount: p.amount,
        status: 'requested',
        reason: null,
        refunded: false,
        version: stored.version,
      };
    case 'TransferDebited':
      return { ...state!, status: 'debited', version: stored.version };
    case 'TransferCredited':
      return { ...state!, status: 'credited', version: stored.version };
    case 'TransferCompleted':
      return { ...state!, status: 'completed', version: stored.version };
    case 'TransferFailed':
      return {
        ...state!,
        status: 'failed',
        reason: p.reason,
        refunded: p.refunded,
        version: stored.version,
      };
    default:
      return state!;
  }
}

export function rehydrateTransfer(events: StoredEvent[]): TransferState | null {
  return events.reduce<TransferState | null>((s, e) => applyTransferEvent(s, e), null);
}
