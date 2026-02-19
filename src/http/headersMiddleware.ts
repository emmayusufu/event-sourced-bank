import type { Request, Response, NextFunction } from 'express';
import { tipSeq } from '../projector/loop.js';
import { getPullerState } from '../replication/puller.js';

export async function replicationHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const local = await tipSeq();
    const role = process.env.ROLE === 'follower' ? 'follower' : 'primary';
    res.setHeader('X-Role', role);
    res.setHeader('X-Local-Seq', String(local));

    if (role === 'primary') {
      res.setHeader('X-Primary-Tip', String(local));
    } else {
      const s = getPullerState();
      const tip = s?.observedPrimaryTip ?? 0;
      res.setHeader('X-Primary-Tip', String(tip));
      res.setHeader('X-Replica-Lag-Events', String(Math.max(0, tip - local)));
    }
    next();
  } catch (err) {
    next(err);
  }
}
