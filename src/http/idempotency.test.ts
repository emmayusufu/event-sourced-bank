import { describe, it, expect } from 'vitest';
import { canonicalize, hashBody } from './idempotency.js';

describe('idempotency canonicalization', () => {
  it('produces the same string for objects with reordered keys', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it('distinguishes objects with different values', () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });

  it('canonicalizes nested objects deterministically', () => {
    const left = { outer: { z: 1, a: 2 }, list: [1, 2] };
    const right = { list: [1, 2], outer: { a: 2, z: 1 } };
    expect(canonicalize(left)).toBe(canonicalize(right));
  });

  it('preserves array order (arrays are ordered)', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('handles null and undefined without throwing', () => {
    expect(() => canonicalize(null)).not.toThrow();
    expect(() => canonicalize(undefined)).not.toThrow();
  });
});

describe('idempotency body hashing', () => {
  it('produces equal hashes for equivalent bodies', () => {
    expect(hashBody({ owner: 'Alice', initialDeposit: 100 })).toBe(
      hashBody({ initialDeposit: 100, owner: 'Alice' }),
    );
  });

  it('produces different hashes for different bodies', () => {
    expect(hashBody({ owner: 'Alice', initialDeposit: 100 })).not.toBe(
      hashBody({ owner: 'Alice', initialDeposit: 101 }),
    );
  });
});
