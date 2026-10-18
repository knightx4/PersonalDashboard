import { joinNotes } from './join-notes';
import { NOTES_MAX } from './notebook';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Bringing a vault note's text into the essay's notes page (plan #2357.3).
 * The notes page is `plan.notes` on learn.essays, so this only works out the
 * new text; the action saves it through the plan store. The vault note is
 * read and never written.
 */

export type VaultNoteText = { id: string; path: string; title: string; body: string };

/** One vault note with its text, or null when it is gone or deleted. */
export async function loadVaultNoteText(
  vault: VaultSupabaseClient,
  noteId: string,
): Promise<VaultNoteText | null> {
  const { data, error } = await vault
    .from('notes')
    .select('id, path, title, body')
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not read the vault note: ${error.message}`);
  return (data as VaultNoteText | null) ?? null;
}

export type BroughtIn =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; error: string };

/**
 * The essay notes with the vault note added at the end under a dated heading.
 * `changed` is false when the note's text is already the last block or has no
 * text. Pure, so the dialog's preview and the save agree.
 */
export function bringNoteIntoNotes(
  notes: string,
  note: { title: string; path: string; body: string },
  date: string,
): BroughtIn {
  const text = joinNotes(notes, note.body, note.title || note.path, date);
  if (text.length > NOTES_MAX) {
    return { ok: false, error: 'The notes would be longer than one page holds.' };
  }
  return { ok: true, text, changed: text !== notes };
}
