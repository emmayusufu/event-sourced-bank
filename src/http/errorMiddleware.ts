import type { ErrorRequestHandler } from 'express';
import {
  BusinessRuleError,
  ConcurrencyError,
  NotFoundError,
  ValidationError,
} from '../shared/errors.js';

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: 'validation', message: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'not_found', message: err.message });
    return;
  }
  if (err instanceof ConcurrencyError) {
    res.status(409).json({
      error: 'concurrency',
      expected: err.expected,
      actual: err.actual,
    });
    return;
  }
  if (err instanceof BusinessRuleError) {
    res.status(422).json({ error: 'business_rule', message: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal' });
};
