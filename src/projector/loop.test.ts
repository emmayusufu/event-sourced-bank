import { describe, it, expect, vi } from 'vitest';

describe('projector dispatch table', () => {
  it('includes the transfer process manager on primary', async () => {
    vi.resetModules();
    vi.stubEnv('ROLE', '');
    const { _handlersForTest } = await import('./loop.js');
    expect(_handlersForTest.map(h => h.name)).toContain('transferProcessManager');
  });

  it('excludes the transfer process manager on follower', async () => {
    vi.resetModules();
    vi.stubEnv('ROLE', 'follower');
    const { _handlersForTest } = await import('./loop.js');
    expect(_handlersForTest.map(h => h.name)).not.toContain('transferProcessManager');
    expect(_handlersForTest.map(h => h.name)).toEqual(
      expect.arrayContaining(['accountProjector', 'transactionProjector', 'ledgerProjector']),
    );
  });
});
