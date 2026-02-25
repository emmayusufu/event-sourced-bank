import { Router } from 'express';
import { tipSeq } from '../../projector/loop.js';
import { getPullerState } from '../../replication/puller.js';

export const replicationRouter = Router();

replicationRouter.get('/admin/replication', async (_req, res, next) => {
  try {
    const localSeq = await tipSeq();
    if (process.env.ROLE === 'follower') {
      const s = getPullerState();
      const primaryTip = s?.observedPrimaryTip ?? 0;
      res.json({
        role: 'follower',
        localSeq,
        primaryTip,
        lagEvents: Math.max(0, primaryTip - localSeq),
        lastPolledAt: s?.lastPolledAt ?? null,
        lastError: s?.lastError ?? null,
      });
    } else {
      res.json({
        role: 'primary',
        localSeq,
        primaryTip: localSeq,
        lagEvents: 0,
        lastPolledAt: null,
        lastError: null,
      });
    }
  } catch (err) {
    next(err);
  }
});
