import { describe, expect, it } from 'vitest';
import { orderCandidateQuery } from './gmail-query';

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
