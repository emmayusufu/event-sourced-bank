import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { handleRequestTransfer } from '../../write/transfer/handlers.js';
import { readStream } from '../../infra/eventStore.js';
import { rehydrateTransfer } from '../../write/transfer/state.js';
import { transferStreamId } from '../../write/transfer/events.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { waitForCheckpoint } from '../../projector/loop.js';

const requestSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  amount: z.number().int().positive(),
});

export const transfersRouter = Router();

transfersRouter.post('/transfers', async (req, res, next) => {
  try {
    const r = requestSchema.safeParse(req.body);
    if (!r.success) throw new ValidationError(r.error.issues.map(i => i.message).join(', '));
    const transferId = uuid();
    const result = await handleRequestTransfer({
      type: 'RequestTransfer',
      transferId,
      fromId: r.data.fromId,
      toId: r.data.toId,
      amount: r.data.amount,
    });
    if (req.query.wait === 'true') await waitForCheckpoint(result.globalSeq);
    res.status(202).json({ transferId: result.transferId, status: result.status });
  } catch (err) {
    next(err);
  }
});

transfersRouter.get('/transfers/:id', async (req, res, next) => {
  try {
    const events = await readStream(transferStreamId(req.params.id));
    const state = rehydrateTransfer(events);
    if (!state) throw new NotFoundError(`transfer ${req.params.id} not found`);
    res.json({
      transferId: state.id,
      fromId: state.fromId,
      toId: state.toId,
      amount: state.amount,
      status: state.status,
      reason: state.reason,
      refunded: state.refunded,
    });
  } catch (err) {
    next(err);
  }
});
