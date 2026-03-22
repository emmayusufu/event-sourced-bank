import express, { type Express } from 'express';
import { accountsRouter } from './routes/accounts.js';
import { transfersRouter } from './routes/transfers.js';
import { adminRouter } from './routes/admin.js';
import { replicationRouter } from './routes/replication.js';
import { errorMiddleware } from './errorMiddleware.js';
import { idempotency } from './idempotency.js';
import { replicationHeaders } from './headersMiddleware.js';
import { readOnlyOnFollower } from './readOnlyMiddleware.js';

export function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(replicationHeaders);
  app.use(readOnlyOnFollower);
  app.use(idempotency);
  app.use(accountsRouter);
  app.use(transfersRouter);
  app.use(adminRouter);
  app.use(replicationRouter);
  app.use(errorMiddleware);
  return app;
}
