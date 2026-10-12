import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  ESSAY_COLUMNS,
  NEW_ESSAY_PATH,
  toEssay,
  toSummary,
  type Essay,
  type EssayRow,
  type EssaySummary,
} from './model';

/**
 * Reads and writes on `learn.essays` (plan #1865), through the person's own
 * session so RLS decides which rows are theirs.
 *
 * The table has no trigger keeping `updated_at`, so every write here sets it.
 */

/** The person's essays, most recently written first. */
export async function loadEssays(supabase: LearnSupabaseClient): Promise<EssaySummary[]> {
  const { data, error } = await supabase
    .from('essays')
    .select(ESSAY_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not read your essays: ${error.message}`);
  return ((data ?? []) as EssayRow[]).map(toSummary);
}

/** One essay, or null when it is not theirs or does not exist. */
export async function loadEssay(supabase: LearnSupabaseClient, id: string): Promise<Essay | null> {
  const { data, error } = await supabase.from('essays').select(ESSAY_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not read the essay: ${error.message}`);
  return data ? toEssay(data as EssayRow) : null;
}

/** A new, empty essay, returning its id. */
export async function createEssay(supabase: LearnSupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('essays')
    .insert({ user_id: userId, path: NEW_ESSAY_PATH, draft_body: '', updated_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not start an essay: ${error?.message ?? 'no row came back'}`);
  return (data as { id: string }).id;
}

/**
 * The draft as last typed. It is now ahead of the vault note, so `unsaved`
 * goes true; the vault save clears it.
 */
export async function saveDraft(
  supabase: LearnSupabaseClient,
  id: string,
  body: string,
): Promise<{ updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('essays')
    .update({ draft_body: body, unsaved: true, updated_at: updatedAt })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That essay is not there any more.');
  return { updatedAt };
}

/** The length the person is aiming at, or null to clear it. */
export async function saveWordTarget(
  supabase: LearnSupabaseClient,
  id: string,
  target: number | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('essays')
    .update({ word_target: target, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That essay is not there any more.');
}
