import { describe, expect, it } from 'vitest';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import type { DevComment } from '@/lib/comments/load';
import type { DashChange } from '@/lib/talk/changes';
import { paidCardHosts, paidCostWords, paidLineState, paidTotal } from './paid-card';

type Paid = Extract<DashChange, { kind: 'paid_action' }>;

const estimate = (medianMicros: number, basis: CostEstimate['basis'] = 'measured'): CostEstimate => ({
  lowMicros: medianMicros / 2,
  medianMicros,
  highMicros: medianMicros * 2,
  runs: 6,
  basis,
  per: 'run',
  models: ['claude-sonnet-5-5'],
});

function paid(id: string, over: Partial<Paid> = {}, cost: CostEstimate | null = estimate(40_000)): Paid {
  return {
    id,
    conversationId: 'c',
    turnId: 't',
    kind: 'paid_action',
    status: 'proposed',
    subjectRef: null,
    writtenTable: null,
    writtenRef: null,
    undo: null,
    createdAt: '2026-10-16T09:00:00Z',
    doneAt: null,
    declinedAt: null,
    undoneAt: null,
    input: {
      tool: 'write_year_review',
      action: 'app/timeline/actions.ts#writeYearReview',
      args: { year: 2026 },
      line: 'Write the review of 2026.',
      estimate: cost,
      workspace: null,
      paths: ['/timeline'],
    },
    ...over,
  };
}

describe('paidLineState', () => {
  it('reads the row, and lets the card press and refusal stand over a waiting row', () => {
    expect(paidLineState(paid('a'))).toEqual({ state: 'waiting' });
    expect(paidLineState(paid('a', { status: 'done' }))).toEqual({ state: 'done' });
    expect(paidLineState(paid('a', { status: 'declined' }))).toEqual({ state: 'declined' });
    expect(paidLineState(paid('a', { undo: { running_at: '2026-10-16T09:01:00Z' } }))).toEqual({ state: 'running' });
    expect(paidLineState(paid('a', { undo: { failed: 'Too few events.' } }))).toEqual({
      state: 'failed',
      error: 'Too few events.',
    });
    expect(paidLineState(paid('a'), { running: true })).toEqual({ state: 'running' });
    expect(paidLineState(paid('a'), { error: 'Offline.' })).toEqual({ state: 'failed', error: 'Offline.' });
    // A line that ran is done whatever the card last heard.
    expect(paidLineState(paid('a', { status: 'done' }), { error: 'Offline.' })).toEqual({ state: 'done' });
  });
});

describe('paidTotal and paidCostWords', () => {
  it('adds the typical runs and says what it could not price', () => {
    expect(paidCostWords(paidTotal([paid('a'), paid('b', {}, estimate(80_000))]))).toBe('about $0.12');
    expect(paidCostWords(paidTotal([paid('a'), paid('b', {}, null)]))).toBe('about $0.04, and one not priced');
    expect(paidCostWords(paidTotal([paid('a', {}, null)]))).toBe('cost not known');
    expect(paidCostWords(estimate(4_000))).toBe('under a cent');
    expect(paidCostWords(null)).toBe('cost not known');
  });
});

describe('paidCardHosts', () => {
  const turn = (id: string, author: DevComment['author'], list?: Paid[]): DevComment => ({
    id,
    author,
    body: id,
    createdAt: '2026-10-16T09:00:00Z',
    ...(list ? { paid: list } : {}),
  });

  it('hangs the card for a comment under the reply Dash wrote to it, or under the comment before one comes', () => {
    const asked = [paid('x'), paid('y')];
    const hosts = paidCardHosts([turn('q', 'me', asked), turn('r', 'claude'), turn('q2', 'me', [paid('z')])]);
    expect(hosts.get('r')).toBe(asked);
    expect(hosts.get('q2')?.map((c) => c.id)).toEqual(['z']);
    expect(hosts.has('q')).toBe(false);
  });

  it('leaves the turns Dash wrote without a card', () => {
    expect(paidCardHosts([turn('r', 'claude', [paid('x')])]).size).toBe(0);
  });
});
