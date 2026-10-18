import { escapeLike } from '@/lib/search/sources/map';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Vault notes attached to an essay's notes (learn.essay_vault_notes), which
 * Dash attaches when asked (attach_vault_note, lib/dash/learn-writes.ts).
 * Prepare lists them, and Update the map reads their text after the notes,
 * as the person's own words. Nothing is copied into the notes.
 *
 * The rows are in learn and the notes in obsidian, so each read takes both
 * of the person's clients and row level security keeps both to their own.
 */

/** The most of one note's text the map reads, and of all of them together. */
export const ATTACHED_NOTE_MAX = 20_000;
export const ATTACHED_TOTAL_MAX = 60_000;

export type AttachedNote = {
  /** The attachment's own id, which Remove takes. */
  id: string;
  noteId: string;
  path: string;
  title: string;
  why: string;
};

/** An attached note with its text, as the map reads it. */
export type AttachedNoteText = { title: string; body: string };

type Link = { id: string; note_id: string; why: string };
type Note = { id: string; path: string; title: string; body?: string };

async function links(learn: LearnSupabaseClient, essayId: string): Promise<Link[]> {
  const { data, error } = await learn
    .from('essay_vault_notes')
    .select('id, note_id, why')
    .eq('essay_id', essayId)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw new Error(`Could not read the essay's attached notes: ${error.message}`);
  return (data ?? []) as Link[];
}

async function notes(vault: VaultSupabaseClient, ids: string[], withBody: boolean): Promise<Map<string, Note>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await vault
    .from('notes')
    .select(withBody ? 'id, path, title, body' : 'id, path, title')
    .in('id', ids)
    .is('deleted_at', null);
  if (error) throw new Error(`Could not read the attached vault notes: ${error.message}`);
  return new Map(((data ?? []) as unknown as Note[]).map((note) => [note.id, note]));
}

/** The notes attached to an essay, oldest first. A note deleted from the vault is left out. */
export async function loadAttachedNotes(
  learn: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  essayId: string,
): Promise<AttachedNote[]> {
  const rows = await links(learn, essayId);
  const found = await notes(vault, rows.map((r) => r.note_id), false);
  return rows.flatMap((row) => {
    const note = found.get(row.note_id);
    return note ? [{ id: row.id, noteId: note.id, path: note.path, title: note.title || note.path, why: row.why }] : [];
  });
}

/** The attached notes' text for the map, each cut to ATTACHED_NOTE_MAX and all to ATTACHED_TOTAL_MAX. */
export async function loadAttachedNoteText(
  learn: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  essayId: string,
): Promise<AttachedNoteText[]> {
  const rows = await links(learn, essayId);
  const found = await notes(vault, rows.map((r) => r.note_id), true);
  let left = ATTACHED_TOTAL_MAX;
  const out: AttachedNoteText[] = [];
  for (const row of rows) {
    const note = found.get(row.note_id);
    const body = (note?.body ?? '').trim().slice(0, Math.min(ATTACHED_NOTE_MAX, left));
    if (!note || !body) continue;
    out.push({ title: note.title || note.path, body });
    left -= body.length;
    if (left <= 0) break;
  }
  return out;
}

/** Take one attached note off the essay. The note itself is untouched. */
export async function detachNote(learn: LearnSupabaseClient, essayId: string, attachmentId: string): Promise<void> {
  const { error } = await learn.from('essay_vault_notes').delete().eq('id', attachmentId).eq('essay_id', essayId);
  if (error) throw new Error(`Could not take the note off the essay: ${error.message}`);
}

/** The most notes a title search returns. */
export const NOTE_SEARCH_LIMIT = 10;

export type VaultNoteMatch = { id: string; path: string; title: string };

/**
 * The person's vault notes whose title contains `query`, newest first, up to
 * NOTE_SEARCH_LIMIT. A deleted note is left out, and so is the essay's own
 * note (learn.essays.note_id), since an essay is not merged into itself. An
 * empty query returns nothing rather than the newest ten. The query is
 * matched as text: a % or _ in it is a character, not a wildcard.
 */
export async function searchVaultNotes(
  learn: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  essayId: string,
  query: string,
): Promise<VaultNoteMatch[]> {
  const needle = query.trim();
  if (!needle) return [];
  const own = await learn.from('essays').select('note_id').eq('id', essayId).maybeSingle();
  if (own.error) throw new Error(`Could not read the essay: ${own.error.message}`);
  const ownNoteId = (own.data as { note_id: string | null } | null)?.note_id ?? null;

  let search = vault
    .from('notes')
    .select('id, path, title')
    .ilike('title', `%${escapeLike(needle)}%`)
    .is('deleted_at', null);
  if (ownNoteId) search = search.neq('id', ownNoteId);
  const { data, error } = await search.order('updated_at', { ascending: false }).limit(NOTE_SEARCH_LIMIT);
  if (error) throw new Error(`Could not search the vault notes: ${error.message}`);
  return ((data ?? []) as unknown as VaultNoteMatch[]).map((n) => ({ id: n.id, path: n.path, title: n.title }));
}

/** Where a vault note opens in the app. */
export function vaultNoteHref(path: string): string {
  return `/vault/n/${path.split('/').map(encodeURIComponent).join('/')}`;
}
