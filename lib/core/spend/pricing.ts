/**
 * What a model call costs, in integer micro-dollars.
 *
 * Pure, and separate from the recording, so the arithmetic can be tested
 * without a database and the price table can be read as a table rather than
 * hunted for in a query. Same split the learn module makes between a payload's
 * rules and the call that produces it.
 *
 * **Micro-dollars, not cents.** A millionth of a dollar. The rule everywhere
 * else in this codebase is integer cents, and it is the right rule for money a
 * person pays; it is the wrong unit here, because a Haiku call costs about two
 * hundredths of a cent and every row would round to zero. Micro-dollars keep
 * the arithmetic integer -- no float ever touches a total -- and happen to make
 * the conversion trivial: a rate quoted in dollars per million tokens is
 * exactly micro-dollars per token.
 *
 * **A model missing from the table records no cost at all.** Not zero. Zero is
 * a claim that the call was free, and the share page already established what
 * this codebase does with a price it does not know: it renders blank. The
 * tokens are recorded either way, so the day a rate is added the old rows can
 * be priced.
 */

/** Dollars per million tokens, which is also micro-dollars per token. */
export type ModelPrice = {
  input: number;
  /** Reading a cached prefix. A tenth of input on every current model. */
  cachedInput: number;
  /** Writing one. A quarter again more than input, for the 5-minute TTL. */
  cacheWrite: number;
  output: number;
};

/**
 * The published rates, as of the last time this file was touched.
 *
 * Only models this app actually calls, plus the two it would obviously reach
 * for next. A rate that is wrong is worse than a rate that is missing -- the
 * missing one shows as unknown and gets noticed, the wrong one quietly adds up
 * -- so nothing is guessed here from a family resemblance.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5': { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-sonnet-5': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  // The dated id is the same model, and both spellings are in this codebase.
  'claude-haiku-4-5-20251001': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
};

/** Tokens as the API reports them. */
export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
};

/**
 * What one call cost, in micro-dollars, or null if the model has no rate.
 *
 * Rounded, not truncated: a thousand truncated calls lose a real fraction of a
 * cent, and the point of this table is that its total can be trusted.
 */
export function costMicrosFor(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;

  const micros =
    usage.inputTokens * price.input +
    usage.cachedInputTokens * price.cachedInput +
    usage.cacheWriteTokens * price.cacheWrite +
    usage.outputTokens * price.output;

  return Math.round(micros);
}

/**
 * Read the usage off a response, whatever shape it arrived in.
 *
 * The SDK's usage object grows fields over time and an older response may not
 * carry the cache ones at all, so every field is defended rather than assumed.
 * A missing count is zero tokens, which is the only reading that cannot
 * overstate what was spent.
 */
export function usageFrom(raw: unknown): TokenUsage {
  if (!raw || typeof raw !== 'object') return EMPTY_USAGE;
  const usage = raw as Record<string, unknown>;

  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

  return {
    inputTokens: count(usage.input_tokens),
    cachedInputTokens: count(usage.cache_read_input_tokens),
    cacheWriteTokens: count(usage.cache_creation_input_tokens),
    outputTokens: count(usage.output_tokens),
  };
}

/** Add up a column of costs, keeping "not known" separate from "nothing". */
export function totalMicros(costs: (number | null)[]): { micros: number; unpriced: number } {
  let micros = 0;
  let unpriced = 0;
  for (const cost of costs) {
    if (cost === null) unpriced += 1;
    else micros += cost;
  }
  return { micros, unpriced };
}

/** One call's worth of spend, on its way to the ledger. */
export type SpendReport = { model: string; usage: TokenUsage };

/**
 * Where a library function hands back what its call cost.
 *
 * A callback rather than a return value, because the functions that spend are
 * the ones whose return type already carries a result the caller cares about,
 * and threading a second concern through every union member of every one of
 * them would make the interesting type harder to read to serve the boring
 * concern. It also fires whether or not the call went on to produce anything
 * usable: a response that came back malformed still cost what it cost, and a
 * ledger that quietly omits the failures understates the bill in exactly the
 * case you would want to see.
 */
export type SpendSink = (report: SpendReport) => void;
