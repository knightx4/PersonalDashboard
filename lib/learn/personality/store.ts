import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { isCompleteAnswers, scoreBigFive, IPIP_ITEM_COUNT } from './ipip';
import {
  fromRow,
  RESULT_COLUMNS,
  type BigFiveResult,
  type PersonalityResult,
  type ResultRow,
  type TypedInput,
  type TypedResult,
} from './model';

/**
 * Reading and writing personality results: the Big Five (plan #1632) and a
 * type typed in from another test (#1633). Through the person's own learn client, so RLS keeps every
 * row to its owner.
 */

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/** Every result, newest first. */
export async function loadPersonalityResults(
  supabase: LearnSupabaseClient,
): Promise<PersonalityResult[]> {
  const { data, error } = await supabase
    .from('personality_results')
    .select(RESULT_COLUMNS)
    .order('taken_at', { ascending: false })
    .order('created_at', { ascending: false });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading your personality results', error);
  return ((data ?? []) as unknown as ResultRow[])
    .map(fromRow)
    .filter((r): r is PersonalityResult => r !== null);
}

/**
 * Score a full set of Big Five answers and keep it as a new result, dated
 * `takenAt` (today in the person's zone). A retake is another row; nothing
 * earlier is replaced.
 */
export async function saveBigFiveResult(
  supabase: LearnSupabaseClient,
  userId: string,
  answers: unknown,
  takenAt: string,
): Promise<BigFiveResult> {
  if (!isCompleteAnswers(answers)) {
    throw new Error(`Answer all ${IPIP_ITEM_COUNT} statements before saving.`);
  }
  const scores = scoreBigFive(answers);

  const { data, error } = await supabase
    .from('personality_results')
    .insert({
      user_id: userId,
      kind: 'big_five',
      test_name: 'Big Five',
      answers,
      taken_at: takenAt,
      ...scores,
    })
    .select(RESULT_COLUMNS)
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw fail('Saving your result', error ?? { message: 'no row' });
  const result = fromRow(data as unknown as ResultRow);
  if (!result || result.kind !== 'big_five') {
    throw new Error('Saving your result failed: the row came back wrong.');
  }
  return result;
}

function asTyped(data: unknown, action: string): TypedResult {
  const result = fromRow(data as ResultRow);
  if (!result || result.kind === 'big_five') {
    throw new Error(`${action} failed: the row came back wrong.`);
  }
  return result;
}

/**
 * Keep a type from another test as the person wrote it (#1633), checked by
 * `parseTypedInput` first. `id` is passed only by the undo of a delete, so
 * the row comes back as it was.
 */
export async function saveTypedResult(
  supabase: LearnSupabaseClient,
  userId: string,
  input: TypedInput,
  id?: string,
): Promise<TypedResult> {
  const { data, error } = await supabase
    .from('personality_results')
    .insert({
      ...(id ? { id } : {}),
      user_id: userId,
      kind: input.kind,
      test_name: input.testName,
      typed_value: input.typedValue,
      taken_at: input.takenAt,
      note: input.note,
    })
    .select(RESULT_COLUMNS)
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw fail('Saving your type', error ?? { message: 'no row' });
  return asTyped(data, 'Saving your type');
}

/**
 * Delete a typed-in type and hand it back, so the page can offer the undo.
 * A Big Five result is not deleted here: the filter on kind leaves it alone
 * whatever id is passed.
 */
export async function deleteTypedResult(
  supabase: LearnSupabaseClient,
  id: string,
): Promise<TypedResult> {
  const { data, error } = await supabase
    .from('personality_results')
    .delete()
    .eq('id', id)
    .neq('kind', 'big_five')
    .select(RESULT_COLUMNS)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Deleting your type', error);
  if (!data) throw new Error('Deleting your type failed: it was not there.');
  return asTyped(data, 'Deleting your type');
}
