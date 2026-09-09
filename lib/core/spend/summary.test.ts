import { describe, expect, it } from 'vitest';
import {
  monthStart,
  rollUp,
  sinceLocalDate,
  tokensOf,
  totalOf,
  type SpendRow,
} from './summary';

/**
 * The sums under the spend screen.
 *
 * What is worth testing here is what happens to a call nobody could price. It
 * has to stay visible -- in the call count, in the token count -- while staying
 * out of the money, because a total that quietly absorbed it would read as
 * complete and be short by however many calls used that model.
 */

let n = 0;
const row = (partial: Partial<SpendRow> = {}): SpendRow => ({
  id: `row-${(n += 1)}`,
  module: 'learn',
  operation: 'plan-topic',
  model: 'claude-opus-5',
  inputTokens: 100,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 50,
  costMicros: 1750,
  createdAt: '2026-09-09T10:00:00.000Z',
  ...partial,
});

describe('the total', () => {
  it('adds the costs and counts the calls', () => {
    expect(totalOf([row(), row(), row()])).toEqual({ calls: 3, micros: 5250, unpriced: 0 });
  });

  it('counts an unpriced call without adding it to the money', () => {
    expect(totalOf([row(), row({ costMicros: null })])).toEqual({
      calls: 2,
      micros: 1750,
      unpriced: 1,
    });
  });

  it('is empty over nothing', () => {
    expect(totalOf([])).toEqual({ calls: 0, micros: 0, unpriced: 0 });
  });
});

describe('the rollup', () => {
  it('groups by module and operation together', () => {
    const groups = rollUp([
      row({ operation: 'plan-topic' }),
      row({ operation: 'plan-topic' }),
      row({ operation: 'locate-passage', costMicros: 20 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ operation: 'plan-topic', calls: 2, micros: 3500 });
    expect(groups[1]).toMatchObject({ operation: 'locate-passage', calls: 1, micros: 20 });
  });

  it('keeps two modules apart even when the operation name matches', () => {
    const groups = rollUp([
      row({ module: 'learn', operation: 'extract' }),
      row({ module: 'jobs', operation: 'extract' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('puts the dearest first', () => {
    const groups = rollUp([
      row({ operation: 'cheap', costMicros: 10 }),
      row({ operation: 'dear', costMicros: 90_000 }),
    ]);
    expect(groups.map((group) => group.operation)).toEqual(['dear', 'cheap']);
  });

  it('carries an unpriced call into its group as a count, not as zero money', () => {
    const groups = rollUp([row({ costMicros: null }), row({ costMicros: 500 })]);
    expect(groups[0]).toMatchObject({ calls: 2, micros: 500, unpriced: 1 });
  });

  it('counts every kind of token towards what the group moved', () => {
    const groups = rollUp([
      row({ inputTokens: 1, cachedInputTokens: 2, cacheWriteTokens: 3, outputTokens: 4 }),
    ]);
    expect(groups[0].tokens).toBe(10);
    expect(tokensOf(row({ inputTokens: 5, outputTokens: 5 }))).toBe(10);
  });
});

describe('this month', () => {
  it('starts on the first of the month the local date falls in', () => {
    expect(monthStart('2026-09-09')).toBe('2026-09-01');
  });

  it('keeps the rows whose local date is in the window', () => {
    // The converter is passed in, so a row recorded at 2026-08-31T23:00Z is in
    // September for somebody in Auckland and in August for somebody in London,
    // and this function does not have to know which.
    const rows = [
      row({ createdAt: '2026-08-31T23:00:00.000Z' }),
      row({ createdAt: '2026-09-02T10:00:00.000Z' }),
    ];

    const inAuckland = (instant: string) =>
      instant.startsWith('2026-08-31') ? '2026-09-01' : '2026-09-02';
    const inLondon = (instant: string) => instant.slice(0, 10);

    expect(sinceLocalDate(rows, '2026-09-01', inAuckland)).toHaveLength(2);
    expect(sinceLocalDate(rows, '2026-09-01', inLondon)).toHaveLength(1);
  });
});
