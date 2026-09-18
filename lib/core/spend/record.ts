import 'server-only';

import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { costMicrosFor, usageFrom, type TokenUsage } from '@/lib/core/spend/pricing';

/**
 * Writing down what a call cost.
 *
 * Best-effort by construction, and that is the design rather than laziness. A
 * ledger row is a measurement of work that already succeeded; if the
 * measurement fails there is nothing to undo and nobody to tell. Throwing here
 * would mean a person loses the reading list they just imported because a
 * bookkeeping insert timed out, which is a strictly worse outcome than a gap
 * in a table only they will ever read.
 *
 * Every write goes through the session client, so RLS decides where it lands,
 * and the user id is passed explicitly on insert because the policy compares
 * it to auth.uid(). The table takes inserts and selects and nothing else, so
 * there is no update path here to get wrong.
 */

/** Which workspace spent it. Matches the module ids used everywhere else. */
export type SpendModule = 'learn' | 'jobs' | 'shopping' | 'vault' | 'todo' | 'core';

export type SpendRecord = {
  module: SpendModule;
  /**
   * What it was doing, in kebab case: 'plan-topic', 'resolve-reference'. The
   * column that turns a total into a finding, so it names the operation rather
   * than the function that happened to make the call.
   */
  operation: string;
  model: string;
  usage: TokenUsage;
};

/**
 * Narrowed to the one method this needs, off the core-bound client type, so a
 * client pointed at another schema still cannot be passed and a test can hand
 * in a stub without standing up a database.
 */
type SpendClient = Pick<CoreSupabaseClient, 'from'>;

/**
 * Record one call. Never throws, never rejects.
 *
 * Returns whether the row landed, for tests and for a caller that wants to
 * log. Nothing in the app should branch on it.
 */
export async function recordSpend(
  supabase: SpendClient,
  userId: string,
  record: SpendRecord,
): Promise<boolean> {
  try {
    const { error } = await supabase.from('model_spend').insert({
      user_id: userId,
      module: record.module,
      operation: record.operation,
      model: record.model,
      input_tokens: record.usage.inputTokens,
      cached_input_tokens: record.usage.cachedInputTokens,
      cache_write_tokens: record.usage.cacheWriteTokens,
      output_tokens: record.usage.outputTokens,
      // Null when the model has no published rate. The tokens are recorded
      // either way, so the row can be priced later.
      cost_micros: costMicrosFor(record.model, record.usage),
    });

    if (error) {
      console.error(`[${CORE_SCHEMA}.model_spend] ${record.module}/${record.operation}`, error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `[${CORE_SCHEMA}.model_spend] ${record.module}/${record.operation}`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Record straight from a response's usage object.
 *
 * The shape callers actually hold: an SDK response whose `usage` may or may
 * not carry the cache fields depending on how the call was made.
 */
export async function recordSpendFromResponse(
  supabase: SpendClient,
  userId: string,
  input: { module: SpendModule; operation: string; model: string; usage: unknown },
): Promise<boolean> {
  return recordSpend(supabase, userId, {
    module: input.module,
    operation: input.operation,
    model: input.model,
    usage: usageFrom(input.usage),
  });
}
