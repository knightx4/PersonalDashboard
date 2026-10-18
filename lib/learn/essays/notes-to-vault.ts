import { joinNotes } from './join-notes';
import { saveNote, type SaveNoteFailure, type SaveNotePorts } from '@/lib/vault/notes/save';

/**
 * Adding an essay's notes to the end of a vault note (plan #2357.4).
 *
 * The joined text is the vault note's stored body with the essay notes under
 * `## <date> · <essay title>` (joinNotes), and it goes through the note
 * editor's save (lib/vault/notes/save.ts): the note is read again, its blob
 * SHA must still be the one the preview was made from, the file keeps its
 * frontmatter, and one commit lands in the vault repository. A note changed
 * in Obsidian since the preview is refused there and left as it was.
 */

export type NotesToVaultFailure = SaveNoteFailure | 'empty';

/** What the person reads when adding the notes does not go through. */
export const NOTES_TO_VAULT_ERRORS: Record<NotesToVaultFailure, string> = {
  empty: 'The essay has no notes to add yet.',
  'not-found': 'That note is not in the vault any more.',
  changed:
    'This note changed since the preview was made, so nothing was added. Look at the preview again before adding.',
  'read-only':
    'The vault token can read notes but not save them. Add a token that can write in vault settings.',
  reconnect: 'The vault needs reconnecting before notes can be added to it.',
  'too-large': 'The note would be too large to save with the essay notes added.',
  error: 'Dash could not add the notes. Try again in a moment.',
};

export type NotesToVaultInput = {
  /** The vault note's path. */
  path: string;
  /** The essay's notes as they are saved (notesOf). */
  notes: string;
  /** The essay's title, for the heading. */
  title: string;
  /** The day for the heading, as 2026-10-18. */
  date: string;
};

export type NotesToVaultPreview =
  | {
      ok: true;
      path: string;
      /** The note's title, or its path when it has none. */
      title: string;
      /** The version the preview was made from; adding refuses any other. */
      blobSha: string;
      /** The note's text now, without its frontmatter. */
      before: string;
      /** The note's text once the notes are added. */
      after: string;
      /** True when the notes are already the note's last block, so adding changes nothing. */
      unchanged: boolean;
    }
  | { ok: false; reason: NotesToVaultFailure; detail: string };

export type NotesToVaultResult =
  | {
      ok: true;
      path: string;
      blobSha: string;
      /** The commit the save made, null when the notes were already there. */
      commitSha: string | null;
    }
  | { ok: false; reason: NotesToVaultFailure; detail: string };

/** The vault note as it would read with the essay notes added. Writes nothing. */
export async function previewNotesToVault(
  loadNote: SaveNotePorts['loadNote'],
  input: NotesToVaultInput,
): Promise<NotesToVaultPreview> {
  if (!input.notes.trim()) return { ok: false, reason: 'empty', detail: 'The essay notes are empty.' };
  const note = await loadNote(input.path);
  if (!note) return { ok: false, reason: 'not-found', detail: `No note at ${input.path} in this vault.` };
  const after = joinNotes(note.body, input.notes, input.title, input.date);
  return {
    ok: true,
    path: note.path,
    title: note.title || note.path,
    blobSha: note.blobSha,
    before: note.body,
    after,
    unchanged: after === note.body,
  };
}

/**
 * Add the essay notes to the end of the vault note at `expectedBlobSha`, the
 * version the preview showed. The join is made again from the stored body,
 * which at that version is the text the preview joined onto.
 */
export async function addNotesToVault(
  ports: SaveNotePorts,
  input: NotesToVaultInput & { expectedBlobSha: string },
): Promise<NotesToVaultResult> {
  if (!input.notes.trim()) return { ok: false, reason: 'empty', detail: 'The essay notes are empty.' };
  const note = await ports.loadNote(input.path);
  if (!note) return { ok: false, reason: 'not-found', detail: `No note at ${input.path} in this vault.` };
  if (note.blobSha !== input.expectedBlobSha) {
    return {
      ok: false,
      reason: 'changed',
      detail: `${input.path} is at ${note.blobSha}, not ${input.expectedBlobSha}.`,
    };
  }
  const text = joinNotes(note.body, input.notes, input.title, input.date);
  if (text === note.body) return { ok: true, path: note.path, blobSha: note.blobSha, commitSha: null };

  const saved = await saveNote(ports, { path: note.path, text, expectedBlobSha: input.expectedBlobSha });
  if (!saved.ok) return saved;
  return { ok: true, path: note.path, blobSha: saved.blobSha, commitSha: saved.commitSha };
}
