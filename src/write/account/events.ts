export type AccountOpened = {
  type: 'AccountOpened';
  accountId: string;
  owner: string;
  initialDeposit: number;
};
export type MoneyDeposited = {
  type: 'MoneyDeposited';
  accountId: string;
  amount: number;
};
export type MoneyWithdrawn = {
  type: 'MoneyWithdrawn';
  accountId: string;
  amount: number;
};
export type AccountClosed = {
  type: 'AccountClosed';
  accountId: string;
};

export type AccountEvent = AccountOpened | MoneyDeposited | MoneyWithdrawn | AccountClosed;

export const accountStreamId = (id: string) => `account-${id}`;
