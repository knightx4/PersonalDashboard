import { describe, expect, it } from 'vitest';
import { functionSpendRows, hitRate, operationLabel } from './function-spend';

const row = (module: string, operation: string, spend30: number, calls30: number, unpriced30 = 0, spend7 = 0) => ({
  module,
  operation,
  spend_7: spend7,
  spend_30: String(spend30),
  calls_30: calls30,
  unpriced_30: unpriced30,
  input_tokens_30: 0,
  cached_tokens_30: 0,
  cache_write_tokens_30: 0,
});

describe('spend per function', () => {
  it('puts the biggest 30-day spender first and keeps each row\'s totals', () => {
    const out = functionSpendRows([
      row('learn', 'plan-topic', 1_000, 4, 0, 200),
      row('core', 'ask-dash', 9_000_000, 120, 3, 4_000_000),
      row('jobs', 'match-evidence', 50_000, 7),
    ]);
    expect(out.map((r) => r.operation)).toEqual(['ask-dash', 'match-evidence', 'plan-topic']);
    expect(out[0]).toMatchObject({ workspace: 'core', spend7: 4_000_000, spend30: 9_000_000, calls30: 120, unpriced30: 3 });
  });

  it('breaks a tie on spend by calls', () => {
    const out = functionSpendRows([row('jobs', 'draft-answer', 0, 2, 2), row('jobs', 'score-openings', 0, 9, 9)]);
    expect(out.map((r) => r.operation)).toEqual(['score-openings', 'draft-answer']);
  });

  it('labels a declared operation in words and falls back to the raw name', () => {
    expect(operationLabel('plan-topic')).toBe('Plan topic');
    expect(operationLabel('ask-dash')).toBe('Ask Dash');
    expect(operationLabel('some-unlisted-call')).toBe('some-unlisted-call');
  });
});

describe('prompt-cache hit rate', () => {
  it('carries the three token sums through as numbers', () => {
    const [out] = functionSpendRows([
      { ...row('core', 'ask-dash', 1, 1), input_tokens_30: '300', cached_tokens_30: 600, cache_write_tokens_30: '100' },
    ]);
    expect(out).toMatchObject({ inputTokens30: 300, cachedTokens30: 600, cacheWriteTokens30: 100 });
  });

  it('is cached over input, cached and cache write together', () => {
    expect(hitRate({ inputTokens30: 300, cachedTokens30: 600, cacheWriteTokens30: 100 })).toBe(0.6);
  });

  it('is null when the function had no input', () => {
    expect(hitRate({ inputTokens30: 0, cachedTokens30: 0, cacheWriteTokens30: 0 })).toBeNull();
  });

  it('is zero, not null, when there was input and none came from the cache', () => {
    expect(hitRate({ inputTokens30: 50, cachedTokens30: 0, cacheWriteTokens30: 0 })).toBe(0);
  });
});
