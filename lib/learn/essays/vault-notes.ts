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

/** Where a vault note opens in the app. */
export function vaultNoteHref(path: string): string {
  return `/vault/n/${path.split('/').map(encodeURIComponent).join('/')}`;
}
