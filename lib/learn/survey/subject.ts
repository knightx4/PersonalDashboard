import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * The hidden survey subjects (plan #840, decision #838).
 *
 * Practice Flow used to ask about themes you write about and goals with no
 * track, and filed those questions and the feed's ideas under a hidden
 * subject marked `survey`. Plan #2313.2 stopped making them: Practice asks
 * only about levels of topics, and a feed idea goes under a subject you chose.
 * The rows already made stay, hidden, so what cites them still reads, and the
 * readers that count per subject leave them out by this list.
 */

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/** Every survey subject's id, for the readers that count per track. */
export async function loadSurveySubjectIds(
  supabase: LearnSupabaseClient,
  userId?: string,
): Promise<Set<string>> {
  let query = supabase.from('subjects').select('id').eq('survey', true);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the survey subjects', error);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}
