import 'server-only';

import { readSources, type StepAnswer } from '@/lib/goals/answers';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

/**
 * Reads of goals.answers (plan #989). The goals routine writes the answers
 * and a trigger on goals.records marks them out of date, so the app only
 * reads them.
 */

type AnswerRow = {
  id: string;
  item_id: string;
  key: string;
  question: string;
  answer: string;
  sources: unknown;
  position: number;
  worked_at: string;
  out_of_date_at: string | null;
};

const COLUMNS = 'id, item_id, key, question, answer, sources, position, worked_at, out_of_date_at';

const toAnswer = (row: AnswerRow): StepAnswer => ({
  id: row.id,
  itemId: row.item_id,
  key: row.key,
  question: row.question,
  answer: row.answer,
  sources: readSources(row.sources),
  position: row.position,
  workedAt: row.worked_at,
  outOfDateAt: row.out_of_date_at,
});

/** The answers on these steps, keyed by step id, each step's in order. */
export async function loadAnswers(
  client: GoalsSupabaseClient,
  itemIds: string[],
): Promise<Record<string, StepAnswer[]>> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from('answers')
    .select(COLUMNS)
    .in('item_id', ids)
    .order('position')
    .order('created_at');
  if (error) throw new Error(`Could not read the answers: ${error.message}`);
  const out: Record<string, StepAnswer[]> = {};
  for (const row of (data ?? []) as AnswerRow[]) {
    (out[row.item_id] ??= []).push(toAnswer(row));
  }
  return out;
}

/** Every answer of this account that is out of date, for the morning run. */
export async function loadOutOfDateAnswers(
  client: GoalsSupabaseClient,
  userId: string,
): Promise<StepAnswer[]> {
  const { data, error } = await client
    .from('answers')
    .select(COLUMNS)
    .eq('user_id', userId)
    .not('out_of_date_at', 'is', null)
    .order('position');
  if (error) throw new Error(`Could not read the out-of-date answers: ${error.message}`);
  return ((data ?? []) as AnswerRow[]).map(toAnswer);
}
