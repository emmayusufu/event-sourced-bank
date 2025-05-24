import { describe, it, expect } from 'vitest';
import { diffReplayVsProjection, type AccountSnapshot } from './reconciliation.js';

const snap = (balance: number, status = 'open', version = 1): AccountSnapshot => ({
  balance,
  status,
  version,
});

describe('diffReplayVsProjection', () => {
  it('returns no drift when both sides agree', () => {
    const replayed = new Map([
      ['a', snap(100, 'open', 3)],
      ['b', snap(50, 'open', 2)],
    ]);
    const projection = new Map([
      ['a', snap(100, 'open', 3)],
      ['b', snap(50, 'open', 2)],
    ]);
    expect(diffReplayVsProjection(replayed, projection)).toEqual([]);
  });

  it('flags balance drift', () => {
    const replayed = new Map([['a', snap(100)]]);
    const projection = new Map([['a', snap(120)]]);
    const drift = diffReplayVsProjection(replayed, projection);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      accountId: 'a',
      replay: { balance: 100 },
      projection: { balance: 120 },
    });
  });

  it('flags status drift', () => {
    const replayed = new Map([['a', snap(0, 'closed', 2)]]);
    const projection = new Map([['a', snap(0, 'open', 2)]]);
    const drift = diffReplayVsProjection(replayed, projection);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.replay?.status).toBe('closed');
    expect(drift[0]?.projection?.status).toBe('open');
  });

  it('flags version drift', () => {
    const replayed = new Map([['a', snap(100, 'open', 5)]]);
    const projection = new Map([['a', snap(100, 'open', 4)]]);
    const drift = diffReplayVsProjection(replayed, projection);
    expect(drift).toHaveLength(1);
  });

  it('flags accounts present in replay but missing from projection (projector lag/loss)', () => {
    const replayed = new Map([['a', snap(100)]]);
    const projection = new Map<string, AccountSnapshot>();
    const drift = diffReplayVsProjection(replayed, projection);
    expect(drift).toEqual([{ accountId: 'a', projection: null, replay: snap(100) }]);
  });

  it('flags accounts present in projection but missing from replay (orphaned projection)', () => {
    const replayed = new Map<string, AccountSnapshot>();
    const projection = new Map([['a', snap(100)]]);
    const drift = diffReplayVsProjection(replayed, projection);
    expect(drift).toEqual([{ accountId: 'a', projection: snap(100), replay: null }]);
  });

  it('reports multiple drifts in a single run', () => {
    const replayed = new Map([
      ['a', snap(100)],
      ['b', snap(200)],
      ['c', snap(300)],
    ]);
    const projection = new Map([
      ['a', snap(100)],
      ['b', snap(999)],
      ['d', snap(400)],
    ]);
    const drift = diffReplayVsProjection(replayed, projection);
    expect(drift.map(d => d.accountId).sort()).toEqual(['b', 'c', 'd']);
  });
});
