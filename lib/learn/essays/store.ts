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
import type { EssayVaultPatch, VaultEssay } from './vault';

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

/** The essay as the vault save reads it (plan #1866). */
export async function loadVaultEssay(supabase: LearnSupabaseClient, id: string): Promise<VaultEssay | null> {
  const { data, error } = await supabase
    .from('essays')
    .select('id, path, note_id, blob_sha, slug, brief')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the essay: ${error.message}`);
  if (!data) return null;
  const row = data as {
    id: string;
    path: string;
    note_id: string | null;
    blob_sha: string | null;
    slug: string | null;
    brief: unknown;
  };
  return { id: row.id, path: row.path, noteId: row.note_id, blobSha: row.blob_sha, slug: row.slug, brief: row.brief };
}

/** The slugs the person's other essays hold. */
export async function takenEssaySlugs(supabase: LearnSupabaseClient, exceptId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('essays').select('slug').neq('id', exceptId).not('slug', 'is', null);
  if (error) throw new Error(`Could not read your essays: ${error.message}`);
  return new Set(((data ?? []) as { slug: string }[]).map((row) => row.slug));
}

/**
 * The note the essay was written to, and the draft that went into it. The
 * draft is now what the vault holds, so `unsaved` goes false.
 */
export async function recordEssayNote(
  supabase: LearnSupabaseClient,
  id: string,
  patch: EssayVaultPatch,
): Promise<void> {
  const { error } = await supabase
    .from('essays')
    .update({
      note_id: patch.noteId,
      path: patch.path,
      blob_sha: patch.blobSha,
      slug: patch.slug,
      draft_body: patch.draftBody,
      unsaved: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Take the vault's version of the note as the draft, after a save stopped
 * because the note changed in Obsidian. The editor holds the body only, so
 * that is what goes in.
 */
export async function adoptNoteVersion(
  supabase: LearnSupabaseClient,
  id: string,
  note: { path: string; body: string; blobSha: string },
): Promise<void> {
  const { error } = await supabase
    .from('essays')
    .update({
      path: note.path,
      blob_sha: note.blobSha,
      draft_body: note.body,
      unsaved: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
