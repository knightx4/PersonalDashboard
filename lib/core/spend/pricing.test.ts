import { describe, expect, it } from 'vitest';
import {
  costMicrosFor,
  EMPTY_USAGE,
  MODEL_PRICES,
  sumByModel,
  totalMicros,
  usageFrom,
  WEB_SEARCH_MICROS,
  type TokenUsage,
} from './pricing';

/**
 * The arithmetic the whole ledger rests on.
 *
 * Worth testing hard for a boring reason: every number on the spend screen is
 * this function summed, so an error here is invisible and cumulative. It is
 * also the only place in the app where money is not integer cents, which is
 * exactly the kind of exception that gets "fixed" by somebody later.
 */

const usage = (partial: Partial<TokenUsage>): TokenUsage => ({ ...EMPTY_USAGE, ...partial });

describe('what a call cost', () => {
  it('prices a million input tokens at the published dollar rate', () => {
    // A rate in dollars per million tokens is micro-dollars per token, which
    // is the whole reason this unit was chosen. $5.00 is 5,000,000 micros.
    expect(costMicrosFor('claude-opus-5', usage({ inputTokens: 1_000_000 }))).toBe(5_000_000);
  });

  it('prices output higher than input', () => {
    const input = costMicrosFor('claude-opus-5', usage({ inputTokens: 1000 }));
    const output = costMicrosFor('claude-opus-5', usage({ outputTokens: 1000 }));
    expect(output).toBeGreaterThan(input!);
  });

  it('prices a cache read at a tenth of ordinary input', () => {
    const plain = costMicrosFor('claude-opus-5', usage({ inputTokens: 10_000 }))!;
    const cached = costMicrosFor('claude-opus-5', usage({ cachedInputTokens: 10_000 }))!;
    expect(cached * 10).toBe(plain);
  });

  it('prices a cache write above ordinary input', () => {
    const plain = costMicrosFor('claude-opus-5', usage({ inputTokens: 10_000 }))!;
    const written = costMicrosFor('claude-opus-5', usage({ cacheWriteTokens: 10_000 }))!;
    expect(written).toBeGreaterThan(plain);
  });

  it('adds the four kinds together', () => {
    const cost = costMicrosFor(
      'claude-haiku-4-5',
      usage({
        inputTokens: 1000,
        cachedInputTokens: 2000,
        cacheWriteTokens: 400,
        outputTokens: 500,
      }),
    );
    // 1000×1 + 2000×0.1 + 400×1.25 + 500×5 = 1000 + 200 + 500 + 2500
    expect(cost).toBe(4200);
  });

  it('costs nothing when nothing was spent', () => {
    expect(costMicrosFor('claude-opus-5', EMPTY_USAGE)).toBe(0);
  });

  it('returns null for a model with no published rate, never zero', () => {
    // Zero would say the call was free. The tokens are still recorded, so this
    // row can be priced the day the rate is added.
    expect(costMicrosFor('claude-something-unreleased', usage({ inputTokens: 5000 }))).toBeNull();
  });

  it('rounds rather than truncates', () => {
    // One token of cached input on Haiku is a tenth of a micro-dollar. Truncating
    // makes a thousand such calls cost nothing at all.
    expect(costMicrosFor('claude-haiku-4-5', usage({ cachedInputTokens: 5 }))).toBe(1);
  });

  it('adds the web search fee, a cent a search, on top of the tokens', () => {
    // $10 per thousand searches is $0.01, ten thousand micro-dollars, each.
    expect(WEB_SEARCH_MICROS).toBe(10_000);
    const tokens = costMicrosFor('claude-sonnet-5', usage({ inputTokens: 1000, outputTokens: 100 }))!;
    expect(costMicrosFor('claude-sonnet-5', usage({ inputTokens: 1000, outputTokens: 100, webSearchRequests: 3 }))).toBe(
      tokens + 30_000,
    );
  });

  it('has a rate for every model this app calls, and for the older ones already in the ledger', () => {
    for (const model of [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-haiku-4-5-20251001',
    ]) {
      expect(MODEL_PRICES[model]).toBeDefined();
    }
  });

  it('reads the Opus 5.5 cache at a twentieth of input', () => {
    // 10,000×4 + 10,000×0.2 = 40,000 + 2,000
    expect(costMicrosFor('claude-opus-5-5', usage({ inputTokens: 10_000, cachedInputTokens: 10_000 }))).toBe(42_000);
  });

  it('prices a Haiku 5.5 prompt of up to 100K tokens on the short-prompt card', () => {
    // 100,000×0.1 + 1,000×0.5 = 10,000 + 500
    expect(costMicrosFor('claude-haiku-5-5', usage({ inputTokens: 100_000, outputTokens: 1000 }))).toBe(10_500);
  });

  it('prices a longer Haiku 5.5 prompt, cached tokens counted, on the long-prompt card', () => {
    // The prompt is 60,000 + 50,000 = 110,000 tokens, over the line:
    // 60,000×0.5 + 50,000×0.05 + 1,000×2.5 = 30,000 + 2,500 + 2,500
    expect(
      costMicrosFor('claude-haiku-5-5', usage({ inputTokens: 60_000, cachedInputTokens: 50_000, outputTokens: 1000 })),
    ).toBe(35_000);
  });
});

describe('reading usage off a response', () => {
  it('takes the four counts the API reports', () => {
    expect(
      usageFrom({
        input_tokens: 120,
        output_tokens: 45,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 30,
      }),
    ).toEqual({
      inputTokens: 120,
      cachedInputTokens: 900,
      cacheWriteTokens: 30,
      outputTokens: 45,
    });
  });

  it('treats a missing cache count as no cached tokens', () => {
    // An older response carries no cache fields at all, and absent must read as
    // zero rather than as anything that could overstate the spend.
    expect(usageFrom({ input_tokens: 10, output_tokens: 5 })).toEqual({
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
    });
  });

  it('takes the web searches the call ran, and leaves them off when there were none', () => {
    expect(
      usageFrom({ input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 4 } }),
    ).toEqual({ inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, webSearchRequests: 4 });
    expect(usageFrom({ input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 0 } })).not.toHaveProperty(
      'webSearchRequests',
    );
    expect(usageFrom({ input_tokens: 10, server_tool_use: 'nonsense' })).not.toHaveProperty('webSearchRequests');
  });

  it('survives a response with no usage at all', () => {
    expect(usageFrom(undefined)).toEqual(EMPTY_USAGE);
    expect(usageFrom(null)).toEqual(EMPTY_USAGE);
    expect(usageFrom('nonsense')).toEqual(EMPTY_USAGE);
  });

  it('ignores a nonsense count rather than propagating it', () => {
    expect(usageFrom({ input_tokens: -5, output_tokens: Number.NaN })).toEqual(EMPTY_USAGE);
  });
});

describe('adding a column of costs', () => {
  it('keeps what could not be priced out of the total, and counts it', () => {
    expect(totalMicros([1000, null, 250, null])).toEqual({ micros: 1250, unpriced: 2 });
  });

  it('is zero and empty over nothing', () => {
    expect(totalMicros([])).toEqual({ micros: 0, unpriced: 0 });
  });
});

describe('one report per model', () => {
  it('adds the web searches along with the tokens', () => {
    const [sonnet] = sumByModel([
      { model: 'claude-sonnet-5', usage: usage({ inputTokens: 100, webSearchRequests: 2 }) },
      { model: 'claude-sonnet-5', usage: usage({ inputTokens: 50 }) },
      { model: 'claude-sonnet-5', usage: usage({ inputTokens: 10, webSearchRequests: 1 }) },
    ]);
    expect(sonnet.usage).toMatchObject({ inputTokens: 160, webSearchRequests: 3 });
  });
});
