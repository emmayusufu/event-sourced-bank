import { describe, it, expect } from 'vitest';
import type { StoredEvent } from '../../infra/eventStore.js';
import { rehydrateTransfer } from './state.js';

function ev(type: string, payload: Record<string, unknown>, version: number): StoredEvent {
  return {
    globalSeq: version,
    streamId: `transfer-${(payload as { transferId: string }).transferId}`,
    version,
    type,
    payload,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

const requested = (id: string, amount = 30) =>
  ev('TransferRequested', { transferId: id, fromId: 'A', toId: 'B', amount }, 1);

describe('transfer aggregate', () => {
  it('walks through requested → debited → credited → completed', () => {
    const id = 'T';
    const events = [
      requested(id),
      ev('TransferDebited', { transferId: id }, 2),
      ev('TransferCredited', { transferId: id }, 3),
      ev('TransferCompleted', { transferId: id }, 4),
    ];
    expect(rehydrateTransfer(events.slice(0, 1))?.status).toBe('requested');
    expect(rehydrateTransfer(events.slice(0, 2))?.status).toBe('debited');
    expect(rehydrateTransfer(events.slice(0, 3))?.status).toBe('credited');
    expect(rehydrateTransfer(events)?.status).toBe('completed');
  });

  it('records reason and refunded flag on TransferFailed', () => {
    const id = 'T';
    const s = rehydrateTransfer([
      requested(id),
      ev('TransferDebited', { transferId: id }, 2),
      ev('TransferFailed', { transferId: id, reason: 'recipient closed', refunded: true }, 3),
    ]);
    expect(s).toMatchObject({
      status: 'failed',
      reason: 'recipient closed',
      refunded: true,
    });
  });

  it('preserves the original amount and parties through the saga', () => {
    const id = 'T';
    const s = rehydrateTransfer([
      requested(id, 250),
      ev('TransferDebited', { transferId: id }, 2),
      ev('TransferCredited', { transferId: id }, 3),
      ev('TransferCompleted', { transferId: id }, 4),
    ]);
    expect(s?.amount).toBe(250);
    expect(s?.fromId).toBe('A');
    expect(s?.toId).toBe('B');
  });

  it('returns null for an empty stream', () => {
    expect(rehydrateTransfer([])).toBeNull();
  });
});
