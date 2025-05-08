import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import {
  handleCloseAccount,
  handleDeposit,
  handleOpenAccount,
  handleWithdraw,
} from '../../write/account/handlers.js';
import { ValidationError, NotFoundError } from '../../shared/errors.js';
import { getAccount, getTransactions, listOpenAccounts } from '../../read/queries.js';
import { waitForCheckpoint } from '../../projector/loop.js';

const openSchema = z.object({
  owner: z.string().min(1),
  initialDeposit: z.number().int().nonnegative(),
});
const amountSchema = z.object({
  amount: z.number().int().positive(),
  expectedVersion: z.number().int().nonnegative(),
});
const closeSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

function parse<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ValidationError(r.error.issues.map(i => i.message).join(', '));
  return r.data;
}

export const accountsRouter = Router();

accountsRouter.post('/accounts', async (req, res, next) => {
  try {
    const body = parse(openSchema, req.body);
    const accountId = uuid();
    const result = await handleOpenAccount({
      type: 'OpenAccount',
      accountId,
      owner: body.owner,
      initialDeposit: body.initialDeposit,
    });
    if (req.query.wait === 'true') await waitForCheckpoint(result.globalSeq);
    res.status(201).json({ accountId, version: result.version });
  } catch (err) { next(err); }
});

accountsRouter.post('/accounts/:id/deposits', async (req, res, next) => {
  try {
    const body = parse(amountSchema, req.body);
    const result = await handleDeposit({
      type: 'Deposit',
      accountId: req.params.id,
      amount: body.amount,
      expectedVersion: body.expectedVersion,
    });
    if (req.query.wait === 'true') await waitForCheckpoint(result.globalSeq);
    res.json({ version: result.version });
  } catch (err) { next(err); }
});

accountsRouter.post('/accounts/:id/withdrawals', async (req, res, next) => {
  try {
    const body = parse(amountSchema, req.body);
    const result = await handleWithdraw({
      type: 'Withdraw',
      accountId: req.params.id,
      amount: body.amount,
      expectedVersion: body.expectedVersion,
    });
    if (req.query.wait === 'true') await waitForCheckpoint(result.globalSeq);
    res.json({ version: result.version });
  } catch (err) { next(err); }
});

accountsRouter.post('/accounts/:id/close', async (req, res, next) => {
  try {
    const body = parse(closeSchema, req.body);
    const result = await handleCloseAccount({
      type: 'CloseAccount',
      accountId: req.params.id,
      expectedVersion: body.expectedVersion,
    });
    if (req.query.wait === 'true') await waitForCheckpoint(result.globalSeq);
    res.json({ version: result.version });
  } catch (err) { next(err); }
});

accountsRouter.get('/accounts', async (_req, res, next) => {
  try {
    res.json(await listOpenAccounts());
  } catch (err) { next(err); }
});

accountsRouter.get('/accounts/:id', async (req, res, next) => {
  try {
    const a = await getAccount(req.params.id);
    if (!a) throw new NotFoundError(`account ${req.params.id} not found`);
    res.json(a);
  } catch (err) { next(err); }
});

accountsRouter.get('/accounts/:id/transactions', async (req, res, next) => {
  try {
    res.json(await getTransactions(req.params.id));
  } catch (err) { next(err); }
});
