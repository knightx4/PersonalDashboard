import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { DashCall, DashSurface } from './loop';

/**
 * A Dash answer that failed, kept with its reason (plan #2937.2, migration
 * 0297 core.dash_failures). Two outcomes are kept: 'failed', when no answer
 * was written at all, and 'unfinished', when what was kept is not the answer
 * the model was asked for (notes only, or rows from the lookups). The daily
 * health check raises every one (lib/dash/quality/health.ts), and the Dash
 * quality session reads them before thumbs down.
 */

export type DashFailureOutcome = 'failed' | 'unfinished';

export type DashFailure = {
  surface: DashSurface;
  outcome: DashFailureOutcome;
  /** Why, as the person or a session would read it. */
  reason: string;
  model: string;
  effort?: string | null;
  think?: boolean;
  /** The workspace the question was kept to, so Try again can keep it too. */
  scope?: string | null;
  /** The Ask Dash chat. */
  conversationId?: string | null;
  /** The question's turn. */
  turnId?: string | null;
  /** For a thread or a capture: the row it hangs from, as `schema.table:id`. */
  subjectRef?: string | null;
  calls: readonly DashCall[];
};

/** Said of an answer kept as rows or notes rather than the model's own words. */
export const UNFINISHED_REASON = 'The model did not write its answer, so what was kept is built from its notes or its lookups.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The row a failure is kept as. Ids that are not uuids are dropped, never sent to fail the insert. */
export function failureRow(userId: string, failure: DashFailure): Record<string, unknown> {
  const id = (value: string | null | undefined) => (value && UUID.test(value) ? value : null);
  return {
    user_id: userId,
    surface: failure.surface,
    outcome: failure.outcome,
    reason: (failure.reason.trim() || 'No reason was given.').slice(0, 2000),
    model: failure.model,
    effort: failure.effort ?? null,
    think: failure.think === true,
    scope: failure.scope ?? null,
    conversation_id: id(failure.conversationId),
    turn_id: id(failure.turnId),
    subject_ref: failure.subjectRef ?? null,
    calls: failure.calls.slice(0, 40).map((call) => ({
      stop: call.stop,
      blocks: call.blocks,
      output_tokens: call.outputTokens,
      input_tokens: call.inputTokens,
      cached_input_tokens: call.cachedInputTokens,
      cache_write_tokens: call.cacheWriteTokens,
      ...(call.error ? { error: call.error } : {}),
    })),
  };
}

/** Keeps one failure through the client given. Never throws: a record that is not kept leaves the answer as it was. */
export async function keepFailure(core: CoreSupabaseClient, userId: string, failure: DashFailure): Promise<void> {
  try {
    const { error } = await core.from('dash_failures').insert(failureRow(userId, failure));
    if (error) console.error('the failed answer was not recorded', error.message);
  } catch (error) {
    console.error('the failed answer was not recorded', error);
  }
}

/** The switches the last failure in an Ask chat was asked with, or null; for Try again. */
export async function lastFailureSwitches(
  core: CoreSupabaseClient,
  userId: string,
  conversationId: string,
): Promise<{ think: boolean; scope: string | null } | null> {
  if (!UUID.test(conversationId)) return null;
  const { data, error } = await core
    .from('dash_failures')
    .select('think, scope')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .eq('surface', 'ask')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { think: boolean | null; scope: string | null };
  return { think: row.think === true, scope: row.scope ?? null };
}
