import { appendToStream, readStream } from '../../infra/eventStore.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { accountStreamId } from './events.js';
import { rehydrateAccount } from './state.js';
import type {
  OpenAccountCommand,
  DepositCommand,
  WithdrawCommand,
  CloseAccountCommand,
} from './commands.js';

export type CommandResult = { version: number; globalSeq: number };

export async function handleOpenAccount(cmd: OpenAccountCommand): Promise<CommandResult> {
  if (!cmd.owner) throw new ValidationError('owner is required');
  if (cmd.initialDeposit < 0) throw new ValidationError('initialDeposit must be >= 0');

  const stream = accountStreamId(cmd.accountId);
  const existing = await readStream(stream);
  if (existing.length > 0) throw new BusinessRuleError('account already exists');

  return appendToStream(stream, 0, [{
    type: 'AccountOpened',
    payload: {
      accountId: cmd.accountId,
      owner: cmd.owner,
      initialDeposit: cmd.initialDeposit,
    },
    metadata: cmd.metadata,
  }]);
}

export async function handleDeposit(cmd: DepositCommand): Promise<CommandResult> {
  if (cmd.amount <= 0) throw new ValidationError('amount must be > 0');

  const stream = accountStreamId(cmd.accountId);
  const events = await readStream(stream);
  const state = rehydrateAccount(events);
  if (!state) throw new NotFoundError(`account ${cmd.accountId} not found`);
  if (state.status === 'closed') throw new BusinessRuleError('account closed');

  return appendToStream(stream, cmd.expectedVersion, [{
    type: 'MoneyDeposited',
    payload: { accountId: cmd.accountId, amount: cmd.amount },
    metadata: cmd.metadata,
  }]);
}

export async function handleWithdraw(cmd: WithdrawCommand): Promise<CommandResult> {
  if (cmd.amount <= 0) throw new ValidationError('amount must be > 0');

  const stream = accountStreamId(cmd.accountId);
  const events = await readStream(stream);
  const state = rehydrateAccount(events);
  if (!state) throw new NotFoundError(`account ${cmd.accountId} not found`);
  if (state.status === 'closed') throw new BusinessRuleError('account closed');
  if (state.balance < cmd.amount) throw new BusinessRuleError('insufficient funds');

  return appendToStream(stream, cmd.expectedVersion, [{
    type: 'MoneyWithdrawn',
    payload: { accountId: cmd.accountId, amount: cmd.amount },
    metadata: cmd.metadata,
  }]);
}

export async function handleCloseAccount(cmd: CloseAccountCommand): Promise<CommandResult> {
  const stream = accountStreamId(cmd.accountId);
  const events = await readStream(stream);
  const state = rehydrateAccount(events);
  if (!state) throw new NotFoundError(`account ${cmd.accountId} not found`);
  if (state.status === 'closed') throw new BusinessRuleError('already closed');

  return appendToStream(stream, cmd.expectedVersion, [{
    type: 'AccountClosed',
    payload: { accountId: cmd.accountId },
    metadata: cmd.metadata,
  }]);
}
