import { describe, expect, it } from 'vitest';
import { incrementalFallbackQuery, orderCandidateQuery } from './gmail-query';

describe('orderCandidateQuery', () => {
  it('requires order-ish subjects and avoids bare from:amazon', () => {
    const q = orderCandidateQuery(180);
    expect(q).toMatch(/subject:order/);
    expect(q).toMatch(/newer_than:180d/);
    expect(q).not.toMatch(/from:amazon\.com/);
    expect(q).not.toMatch(/"your order of"/);
  });

  it('clamps the backfill window', () => {
    expect(orderCandidateQuery(1)).toMatch(/newer_than:30d/);
    expect(orderCandidateQuery(9999)).toMatch(/newer_than:730d/);
  });
});

describe('incrementalFallbackQuery', () => {
  it('uses at least a week when never synced', () => {
    const q = incrementalFallbackQuery(null, new Date('2026-07-29T12:00:00Z'));
    expect(q).toMatch(/newer_than:\d+d/);
    expect(q).toMatch(/subject:order/);
  });

  it('widens when last sync was longer ago', () => {
    const q = incrementalFallbackQuery(
      '2026-07-01T12:00:00Z',
      new Date('2026-07-29T12:00:00Z'),
    );
    // orderCandidateQuery clamps to min 30 days.
    expect(q).toMatch(/newer_than:30d/);
  });
});
