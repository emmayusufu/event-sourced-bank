import express, { type Express } from 'express';
import { accountsRouter } from './routes/accounts.js';
import { transfersRouter } from './routes/transfers.js';
import { errorMiddleware } from './errorMiddleware.js';

export function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(accountsRouter);
  app.use(transfersRouter);
  app.use(errorMiddleware);
  return app;
}
