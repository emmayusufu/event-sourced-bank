import { describe, it, expect } from 'vitest';
import type { StoredEvent } from '../../infra/eventStore.js';
import { applyAccountEvent, rehydrateAccount } from './state.js';

function ev(type: string, payload: Record<string, unknown>, version: number): StoredEvent {
  return {
    globalSeq: version,
    streamId: `account-${(payload as { accountId: string }).accountId}`,
    version,
    type,
    payload,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('account aggregate', () => {
  it('opens with the initial deposit as starting balance', () => {
    const s = rehydrateAccount([
      ev('AccountOpened', { accountId: 'a', owner: 'Alice', initialDeposit: 100 }, 1),
    ]);
    expect(s).toMatchObject({
      id: 'a',
      owner: 'Alice',
      balance: 100,
      status: 'open',
      version: 1,
    });
  });

  it('balance accumulates deposits and withdrawals', () => {
    const s = rehydrateAccount([
      ev('AccountOpened', { accountId: 'a', owner: 'Alice', initialDeposit: 100 }, 1),
      ev('MoneyDeposited', { accountId: 'a', amount: 50 }, 2),
      ev('MoneyWithdrawn', { accountId: 'a', amount: 30 }, 3),
    ]);
    expect(s?.balance).toBe(120);
    expect(s?.version).toBe(3);
  });

  it('transitions to closed only after AccountClosed', () => {
    const opened = ev('AccountOpened', { accountId: 'a', owner: 'A', initialDeposit: 0 }, 1);
    const closed = ev('AccountClosed', { accountId: 'a' }, 2);
    expect(rehydrateAccount([opened])?.status).toBe('open');
    expect(rehydrateAccount([opened, closed])?.status).toBe('closed');
    expect(rehydrateAccount([opened, closed])?.closedAt).toBeInstanceOf(Date);
  });

  it('returns null for an empty stream', () => {
    expect(rehydrateAccount([])).toBeNull();
  });

  it('rejects events arriving before AccountOpened', () => {
    const e = ev('MoneyDeposited', { accountId: 'a', amount: 50 }, 1);
    expect(() => applyAccountEvent(null, e)).toThrow(/before open/);
  });

  it('preserves owner across the aggregate lifecycle', () => {
    const s = rehydrateAccount([
      ev('AccountOpened', { accountId: 'a', owner: 'Alice', initialDeposit: 0 }, 1),
      ev('MoneyDeposited', { accountId: 'a', amount: 1 }, 2),
      ev('AccountClosed', { accountId: 'a' }, 3),
    ]);
    expect(s?.owner).toBe('Alice');
  });
});
