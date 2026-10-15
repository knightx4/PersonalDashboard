import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  answeredCount,
  correctTotal,
  nextItemIndex,
  type ExternalCheck,
  type ExternalCheckListItem,
  type ExternalItem,
} from './model';

/**
 * Reading and writing external item sets. Every query goes through the
 * session client, so RLS decides whose rows come back. Nothing here touches
 * the concept graph: the items are kept on the row and nowhere else.
 */

type Row = {
  id: string;
  name: string;
  items: ExternalItem[];
  correct_count: number | null;
  scored_at: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = 'id, name, items, correct_count, scored_at, created_at, updated_at';

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

function toCheck(row: Row): ExternalCheck {
  return {
    id: row.id,
    name: row.name,
    items: row.items,
    correctCount: row.correct_count,
    scoredAt: row.scored_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listExternalChecks(supabase: LearnSupabaseClient): Promise<ExternalCheckListItem[]> {
  const { data, error } = await supabase
    .from('external_checks')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the external sets', error);
  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    total: row.items.length,
    answered: answeredCount(row.items),
    correctCount: row.correct_count,
    on: row.scored_at ?? row.created_at,
    scored: row.scored_at !== null,
  }));
}

export async function loadExternalCheck(
  supabase: LearnSupabaseClient,
  id: string,
): Promise<ExternalCheck | null> {
  const { data, error } = await supabase.from('external_checks').select(COLUMNS).eq('id', id).maybeSingle();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the external set', error);
  return data ? toCheck(data as Row) : null;
}

export async function createExternalCheck(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { name: string; items: readonly ExternalItem[] },
): Promise<string> {
  const { data, error } = await supabase
    .from('external_checks')
    .insert({ user_id: userId, name: input.name, items: input.items })
    .select('id')
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw fail('Keeping the external set', error ?? { message: 'no row' });
  return (data as { id: string }).id;
}

/**
 * Keep one answer, for the item being served. The update only lands if the
 * row is as it was read (same updated_at) and not yet scored, so a double
 * submit marks nothing twice. When it was the last item the score is fixed in
 * the same write.
 */
export async function recordExternalAnswer(
  supabase: LearnSupabaseClient,
  check: ExternalCheck,
  answer: { response: string; correct: boolean },
): Promise<{ saved: boolean; finished: boolean }> {
  const index = nextItemIndex(check.items);
  if (index === null) return { saved: false, finished: true };
  const items = check.items.map((item, at) =>
    at === index ? { ...item, response: answer.response, correct: answer.correct } : item,
  );
  const finished = nextItemIndex(items) === null;

  const { data, error } = await supabase
    .from('external_checks')
    .update(
      finished
        ? { items, correct_count: correctTotal(items), scored_at: new Date().toISOString() }
        : { items },
    )
    .eq('id', check.id)
    .eq('updated_at', check.updatedAt)
    .is('scored_at', null)
    .select('id');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Keeping the answer', error);
  return { saved: (data ?? []).length > 0, finished };
}
