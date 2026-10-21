import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * Answers to an application's questions and the answer bank, as the role
 * page, the answer bank and Dash's save_answer and set_default_answer write
 * them (plan #2473.2).
 */

type Row = Record<string, unknown>;
type Written = { row: Row | null; error: string | null };

export const ANSWER_STATUSES = ['draft', 'approved', 'submitted'] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

/** The columns an answer save may set. `considerations` took over from `unsupported_claims`, which is still written. */
export type AnswerEdit = {
  answer?: string;
  status?: AnswerStatus;
  evidence_item_ids?: string[];
  unsupported_claims?: string[];
  considerations?: string[];
};

/** Write `update` onto one of the person's answers and return it as it now is. */
export async function saveAnswerEdit(supabase: AppSupabaseClient, userId: string, answerId: string, update: AnswerEdit): Promise<Written> {
  const { data, error } = await supabase
    .from('application_answers')
    .update(update)
    .eq('id', answerId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as Row | null) ?? null, error: null };
}

/**
 * Count the evidence an answer now rests on as used once more. Best effort:
 * a use count that did not tick is no reason to lose the answer just saved,
 * so a failure is logged and not returned.
 */
export async function countEvidenceUse(supabase: AppSupabaseClient, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  try {
    const { error } = await supabase.rpc('bump_evidence_use', { item_ids: [...itemIds] });
    if (error) console.error('counting the evidence used failed', error);
  } catch (error) {
    console.error('counting the evidence used failed', error);
  }
}

/** Make `answer` the one reused for a question on every application. */
export async function setCanonicalAnswer(supabase: AppSupabaseClient, userId: string, questionId: string, answer: string): Promise<Written> {
  const { data, error } = await supabase
    .from('questions')
    .update({ canonical_answer: answer, canonical_answer_updated_at: new Date().toISOString() })
    .eq('id', questionId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as Row | null) ?? null, error: null };
}
