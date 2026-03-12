import { describe, it, expect, vi } from 'vitest';
import { createPuller, type PullerDeps } from './puller.js';

function makeDeps(overrides: Partial<PullerDeps> = {}): PullerDeps & {
  inserts: any[][];
  calls: string[];
} {
  const inserts: any[][] = [];
  const calls: string[] = [];
  return {
    selectLocalMax: vi.fn(async () => 0),
    insertBatch: vi.fn(async rows => {
      inserts.push(rows);
    }),
    fetchEvents: vi.fn(async (url: string) => {
      calls.push(url);
      return {
        rows: [],
        primaryTip: 0,
      };
    }),
    sleep: vi.fn(async () => {}),
    now: () => new Date('2026-05-21T12:00:00Z'),
    ...overrides,
    inserts,
    calls,
  } as any;
}

describe('puller', () => {
  it('builds the request URL from MAX(global_seq) and a fixed limit of 500', async () => {
    const deps = makeDeps({ selectLocalMax: vi.fn(async () => 17) });
    const puller = createPuller({ primaryUrl: 'http://primary:3000', pollMs: 0, deps });
    await puller.tickOnce();
    expect(deps.fetchEvents).toHaveBeenCalledWith(
      'http://primary:3000/admin/events?after=17&limit=500',
    );
  });

  it('inserts returned rows in order, preserving global_seq', async () => {
    const rows = [
      { globalSeq: 1, streamId: 'a', version: 1, type: 'X', payload: {}, metadata: {}, createdAt: '2026-05-21T12:00:00.000Z' },
      { globalSeq: 2, streamId: 'a', version: 2, type: 'Y', payload: {}, metadata: {}, createdAt: '2026-05-21T12:00:01.000Z' },
    ];
    const deps = makeDeps({
      fetchEvents: vi.fn(async () => ({ rows, primaryTip: 2 })),
    });
    const puller = createPuller({ primaryUrl: 'http://primary:3000', pollMs: 0, deps });
    await puller.tickOnce();
    expect(deps.insertBatch).toHaveBeenCalledWith(rows);
  });

  it('updates observedPrimaryTip from the X-Primary-Tip header, not from the batch', async () => {
    const rows = [
      { globalSeq: 1, streamId: 'a', version: 1, type: 'X', payload: {}, metadata: {}, createdAt: '2026-05-21T12:00:00.000Z' },
    ];
    const deps = makeDeps({
      fetchEvents: vi.fn(async () => ({ rows, primaryTip: 999 })),
    });
    const puller = createPuller({ primaryUrl: 'http://primary:3000', pollMs: 0, deps });
    await puller.tickOnce();
    expect(puller.getState().observedPrimaryTip).toBe(999);
  });

  it('does not insert when the batch is empty but still records the tip', async () => {
    const deps = makeDeps({
      fetchEvents: vi.fn(async () => ({ rows: [], primaryTip: 4 })),
    });
    const puller = createPuller({ primaryUrl: 'http://primary:3000', pollMs: 0, deps });
    await puller.tickOnce();
    expect(deps.insertBatch).not.toHaveBeenCalled();
    expect(puller.getState().observedPrimaryTip).toBe(4);
  });

  it('records lastError and does not insert when the HTTP call rejects', async () => {
    const deps = makeDeps({
      fetchEvents: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const puller = createPuller({ primaryUrl: 'http://primary:3000', pollMs: 0, deps });
    await puller.tickOnce();
    expect(deps.insertBatch).not.toHaveBeenCalled();
    expect(puller.getState().lastError).toContain('boom');
  });
});
