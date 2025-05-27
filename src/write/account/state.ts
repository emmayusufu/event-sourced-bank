import type { StoredEvent } from '../../infra/eventStore.js';
import type { AccountEvent } from './events.js';

export type AccountState = {
  id: string;
  owner: string;
  balance: number;
  status: 'open' | 'closed';
  version: number;
  openedAt: Date;
  closedAt: Date | null;
};

export function applyAccountEvent(state: AccountState | null, stored: StoredEvent): AccountState {
  const e = { ...stored.payload, type: stored.type } as unknown as AccountEvent;
  switch (e.type) {
    case 'AccountOpened':
      return {
        id: e.accountId,
        owner: e.owner,
        balance: e.initialDeposit,
        status: 'open',
        version: stored.version,
        openedAt: stored.createdAt,
        closedAt: null,
      };
    case 'MoneyDeposited':
      if (!state) throw new Error('deposit before open');
      return { ...state, balance: state.balance + e.amount, version: stored.version };
    case 'MoneyWithdrawn':
      if (!state) throw new Error('withdraw before open');
      return { ...state, balance: state.balance - e.amount, version: stored.version };
    case 'AccountClosed':
      if (!state) throw new Error('close before open');
      return { ...state, status: 'closed', version: stored.version, closedAt: stored.createdAt };
  }
}

export function rehydrateAccount(events: StoredEvent[]): AccountState | null {
  return events.reduce<AccountState | null>((s, e) => applyAccountEvent(s, e), null);
}
