import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  ESSAY_COLUMNS,
  NEW_ESSAY_PATH,
  toEssay,
  toSummary,
  type Essay,
  type EssayRow,
  type EssayPin,
  type EssaySummary,
} from './model';
import { draftMarksJson, readDraftMarks, type AuthorMark } from './authorship';
import { newEssayBrief } from './interview';
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

/**
 * A new, empty essay, returning its id. Its brief holds the pins it was
 * started from and the interview's first question (plan #1867).
 */
export async function createEssay(
  supabase: LearnSupabaseClient,
  userId: string,
  pins: readonly EssayPin[] = [],
): Promise<string> {
  const { data, error } = await supabase
    .from('essays')
    .insert({
      user_id: userId,
      path: NEW_ESSAY_PATH,
      draft_body: '',
      brief: newEssayBrief(pins),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not start an essay: ${error?.message ?? 'no row came back'}`);
  return (data as { id: string }).id;
}

/**
 * The draft as last typed, with who wrote which runs of it (plan #1868). It
 * is now ahead of the vault note, so `unsaved` goes true; the vault save
 * clears it.
 */
export async function saveDraft(
  supabase: LearnSupabaseClient,
  id: string,
  body: string,
  marks: readonly AuthorMark[],
): Promise<{ updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('essays')
    .update({ draft_body: body, draft_authorship: draftMarksJson(marks), unsaved: true, updated_at: updatedAt })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That essay is not there any more.');
  return { updatedAt };
}

/** The brief's jsonb as stored, for a write that changes part of it. */
export async function loadBriefJson(supabase: LearnSupabaseClient, id: string): Promise<{ brief: unknown } | null> {
  const { data, error } = await supabase.from('essays').select('brief').eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not read the essay: ${error.message}`);
  return data ? { brief: (data as { brief: unknown }).brief } : null;
}

/** What a check reads besides the text: the brief, and the note to leave out of Already Said (plan #1869). */
export async function loadCheckEssay(
  supabase: LearnSupabaseClient,
  id: string,
): Promise<{ brief: unknown; noteId: string | null } | null> {
  const { data, error } = await supabase.from('essays').select('brief, note_id').eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not read the essay: ${error.message}`);
  if (!data) return null;
  const row = data as { brief: unknown; note_id: string | null };
  return { brief: row.brief, noteId: row.note_id };
}

/** The whole brief, answers and interview together. */
export async function saveBriefJson(
  supabase: LearnSupabaseClient,
  id: string,
  brief: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase
    .from('essays')
    .update({ brief, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That essay is not there any more.');
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
    .select('id, path, note_id, blob_sha, slug, brief, draft_body, draft_authorship')
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
    draft_body: string | null;
    draft_authorship: unknown;
  };
  const draftBody = row.draft_body ?? '';
  return {
    id: row.id,
    path: row.path,
    noteId: row.note_id,
    blobSha: row.blob_sha,
    slug: row.slug,
    brief: row.brief,
    draftBody,
    marks: readDraftMarks(row.draft_authorship, draftBody.length),
  };
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
      draft_authorship: draftMarksJson(patch.draftMarks),
      authorship: patch.authorship,
      unsaved: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Take the vault's version of the note as the draft, after a save stopped
 * because the note changed in Obsidian. The editor holds the body only, so
 * that is what goes in, with the marks its authorship block gave it.
 */
export async function adoptNoteVersion(
  supabase: LearnSupabaseClient,
  id: string,
  note: { path: string; body: string; blobSha: string; marks: readonly AuthorMark[] },
): Promise<void> {
  const { error } = await supabase
    .from('essays')
    .update({
      path: note.path,
      blob_sha: note.blobSha,
      draft_body: note.body,
      draft_authorship: draftMarksJson(note.marks),
      unsaved: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
