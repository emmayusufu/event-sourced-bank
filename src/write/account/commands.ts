export type OpenAccountCommand = {
  type: 'OpenAccount';
  accountId: string;
  owner: string;
  initialDeposit: number;
  metadata?: Record<string, unknown>;
};
export type DepositCommand = {
  type: 'Deposit';
  accountId: string;
  amount: number;
  expectedVersion: number;
  metadata?: Record<string, unknown>;
};
export type WithdrawCommand = {
  type: 'Withdraw';
  accountId: string;
  amount: number;
  expectedVersion: number;
  metadata?: Record<string, unknown>;
};
export type CloseAccountCommand = {
  type: 'CloseAccount';
  accountId: string;
  expectedVersion: number;
  metadata?: Record<string, unknown>;
};
