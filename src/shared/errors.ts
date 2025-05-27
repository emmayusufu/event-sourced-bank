export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ValidationError';
  }
}
export class NotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'NotFoundError';
  }
}
export class BusinessRuleError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BusinessRuleError';
  }
}
export class ConcurrencyError extends Error {
  constructor(
    public expected: number,
    public actual: number,
  ) {
    super(`concurrency conflict: expected ${expected}, actual ${actual}`);
    this.name = 'ConcurrencyError';
  }
}
