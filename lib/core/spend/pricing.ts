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

import { HAIKU, HAIKU_4_5, HAIKU_4_5_DATED, OPUS, SONNET } from '@/lib/core/models';

/** Dollars per million tokens, which is also micro-dollars per token. */
export type ModelPrice = {
  input: number;
  /** Reading a cached prefix. A tenth of input on every current model. */
  cachedInput: number;
  /** Writing one. A quarter again more than input, for the 5-minute TTL. */
  cacheWrite: number;
  output: number;
  /**
   * A second rate card for a long prompt: the rates that apply instead when
   * the prompt (input, cache reads and cache writes together) is over
   * `aboveTokens`. Haiku 5.5 is the one model priced this way.
   */
  longPrompt?: { aboveTokens: number } & Omit<ModelPrice, 'longPrompt'>;
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
  [OPUS]: { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  [SONNET]: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
  [HAIKU]: {
    input: 0.1,
    cachedInput: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
    longPrompt: { aboveTokens: 100_000, input: 0.5, cachedInput: 0.05, cacheWrite: 0.625, output: 2.5 },
  },
  // Haiku 4.5 under both its spellings. Nothing calls it now; the rows the
  // ledger recorded under it keep their price.
  [HAIKU_4_5]: { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  [HAIKU_4_5_DATED]: { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },

  // Voyage, the embedding provider chosen in #724. An embedding call has no
  // output tokens and no prompt cache, so three of the four rates are zero as
  // a fact about the call rather than as a missing figure: there is no way to
  // accrue a token at those rates. The first 200 million tokens of the Voyage
  // 4 generation are free on every account, which this table does not model --
  // it would have to know the running total, and a ledger that reads high
  // until the free tier runs out is the safer of the two errors.
  'voyage-4-lite': { input: 0.02, cachedInput: 0, cacheWrite: 0, output: 0 },
  'voyage-4': { input: 0.06, cachedInput: 0, cacheWrite: 0, output: 0 },
  'voyage-4-large': { input: 0.12, cachedInput: 0, cacheWrite: 0, output: 0 },

  // Jev, TypeSafe's classifier (feature #1161). Charged per input token only:
  // output is free and there is no prompt cache, so those rates are zero as a
  // fact about the call. Only the pinned version is listed; a call answered
  // by a newer one records its tokens unpriced until its rate is added here.
  'jev-1.13.0': { input: 0.042, cachedInput: 0, cacheWrite: 0, output: 0 },
};

/**
 * The web search tool's fee: $10 per thousand searches, so ten thousand
 * micro-dollars a search, billed on top of the tokens the results add.
 */
export const WEB_SEARCH_MICROS = 10_000;

/** Tokens as the API reports them, and the web searches the call ran. */
export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /**
   * Searches run by the web search tool (`usage.server_tool_use`). Absent
   * on a call that offered no search, which is read as none.
   */
  webSearchRequests?: number;
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
  const card = MODEL_PRICES[model];
  if (!card) return null;
  const promptTokens = usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
  const price = card.longPrompt && promptTokens > card.longPrompt.aboveTokens ? card.longPrompt : card;

  const micros =
    usage.inputTokens * price.input +
    usage.cachedInputTokens * price.cachedInput +
    usage.cacheWriteTokens * price.cacheWrite +
    usage.outputTokens * price.output +
    (usage.webSearchRequests ?? 0) * WEB_SEARCH_MICROS;

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

  const serverTools = usage.server_tool_use;
  const searches =
    serverTools && typeof serverTools === 'object'
      ? count((serverTools as Record<string, unknown>).web_search_requests)
      : 0;

  return {
    inputTokens: count(usage.input_tokens),
    cachedInputTokens: count(usage.cache_read_input_tokens),
    cacheWriteTokens: count(usage.cache_creation_input_tokens),
    outputTokens: count(usage.output_tokens),
    ...(searches > 0 ? { webSearchRequests: searches } : {}),
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

/**
 * One report per model, so a batch Jev answered item by item records one
 * spend row rather than twenty.
 */
export function sumByModel(reports: SpendReport[]): SpendReport[] {
  const byModel = new Map<string, SpendReport>();
  for (const report of reports) {
    const seen = byModel.get(report.model);
    if (!seen) {
      byModel.set(report.model, { model: report.model, usage: { ...report.usage } });
      continue;
    }
    seen.usage.inputTokens += report.usage.inputTokens;
    seen.usage.cachedInputTokens += report.usage.cachedInputTokens;
    seen.usage.cacheWriteTokens += report.usage.cacheWriteTokens;
    seen.usage.outputTokens += report.usage.outputTokens;
    const searches = (seen.usage.webSearchRequests ?? 0) + (report.usage.webSearchRequests ?? 0);
    if (searches > 0) seen.usage.webSearchRequests = searches;
  }
  return [...byModel.values()];
}
