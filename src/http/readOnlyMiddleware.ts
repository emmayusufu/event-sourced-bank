import type { Request, Response, NextFunction } from 'express';

export function readOnlyOnFollower(req: Request, res: Response, next: NextFunction): void {
  if (process.env.ROLE === 'follower' && req.method === 'POST') {
    res.status(403).json({
      error: 'read-only replica',
      primaryUrl: process.env.PRIMARY_URL ?? null,
    });
    return;
  }
  next();
}
