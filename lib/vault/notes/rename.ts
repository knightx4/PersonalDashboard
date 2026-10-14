import { parseNote } from '@/lib/vault/markdown/note';
import { notePathIn } from '@/lib/vault/notes/create';
import { basenameOf, folderOf, isTriageNotePath } from '@/lib/vault/paths';
import {
  VaultAuthError,
  VaultConflictError,
  VaultReadOnlyError,
  type VaultSource,
} from '@/lib/vault/providers/types';

/**
 * Renaming a note from its page (note 69c302f1).
 *
 * Obsidian names a note by its file, so a rename is a move in the vault
 * repository: the file's text is committed at the new name in the same
 * folder, then the old file is removed. The stored note keeps its id and only
 * its path, title and blob change, so its map, its threads with Maya and its
 * connections stay with it. The next sync finds the row already at the new
 * path and nothing at the old one, and leaves both alone.
 *
 * Links to the old name in other notes are not rewritten; Obsidian does that
 * itself when a note is renamed there, and the app does not write other notes
 * to follow a rename.
 */

/** Characters Obsidian refuses in a file name, or that break a link to it. */
const UNSAFE = /[\\/:*?"<>|#^[\]]/;
const NAME_MAX = 120;

export type RenameNoteFailure =
  | 'empty'
  | 'unsafe'
  | 'same'
  | 'taken'
  | 'protected'
  | 'not-found'
  | 'changed'
  | 'read-only'
  | 'reconnect'
  | 'error';

export const RENAME_ERRORS: Record<RenameNoteFailure, string> = {
  empty: 'Give the note a name.',
  unsafe: 'A note name cannot hold any of \\ / : * ? " < > | # ^ [ ]',
  same: 'That is already its name.',
  taken: 'A note with that name is already in this folder.',
  protected: 'Quick note triage keeps its name, since the app writes it.',
  'not-found': 'That note is not in the vault any more.',
  changed: 'This note changed since you opened it. Reload it before renaming.',
  'read-only': 'Your vault token can read notes but not write them. Add one that can write in vault settings.',
  reconnect: 'Your vault needs reconnecting before notes can be renamed.',
  error: 'The note could not be renamed. Try again in a moment.',
};

/** The note as a rename reads it. */
export type RenamableNote = { id: string; path: string; blobSha: string };

export type RenameNotePorts = {
  openSource(): Promise<VaultSource | 'none' | 'reauth'>;
  loadNote(path: string): Promise<RenamableNote | null>;
  /** Move the stored note to its new path, only while it is still at `expectedBlobSha`. */
  moveNote(
    noteId: string,
    expectedBlobSha: string,
    row: { path: string; title: string; blobSha: string },
  ): Promise<void>;
};

export type RenameNoteResult =
  | { ok: true; path: string; title: string }
  | { ok: false; reason: RenameNoteFailure; error: string };

function failed(reason: RenameNoteFailure): RenameNoteResult {
  return { ok: false, reason, error: RENAME_ERRORS[reason] };
}

/** The name as typed, without a trailing `.md` and the space around it. */
export function cleanNoteName(raw: string): string {
  return raw.trim().replace(/\.md$/i, '').trim();
}

export function renameCommitMessage(from: string, to: string): string {
  return `Rename ${from} to ${to} from Dash`;
}

export async function renameNote(
  ports: RenameNotePorts,
  input: { path: string; name: string; expectedBlobSha: string },
): Promise<RenameNoteResult> {
  const name = cleanNoteName(input.name).slice(0, NAME_MAX).trim();
  if (!name || /^\.+$/.test(name)) return failed('empty');
  if (UNSAFE.test(name)) return failed('unsafe');
  if (isTriageNotePath(input.path)) return failed('protected');
  if (name === basenameOf(input.path)) return failed('same');

  const note = await ports.loadNote(input.path);
  if (!note) return failed('not-found');
  if (note.blobSha !== input.expectedBlobSha) return failed('changed');

  let source: VaultSource | 'none' | 'reauth';
  try {
    source = await ports.openSource();
  } catch (error) {
    console.error('[vault rename] opening the vault', error instanceof Error ? error.message : error);
    return failed('error');
  }
  if (source === 'none' || source === 'reauth') return failed('reconnect');

  const to = notePathIn(folderOf(note.path), name);
  const message = renameCommitMessage(basenameOf(note.path), name);

  let text: string;
  let written: { blobSha: string };
  try {
    text = await source.readBlob(note.blobSha);
    written = await source.createNote(to, text, message);
  } catch (error) {
    if (error instanceof VaultConflictError) return failed('taken');
    if (error instanceof VaultReadOnlyError) return failed('read-only');
    if (error instanceof VaultAuthError) return failed('reconnect');
    console.error('[vault rename] writing the new file', error instanceof Error ? error.message : error);
    return failed('error');
  }

  try {
    await source.deleteNote(note.path, note.blobSha, message);
  } catch (error) {
    // The old file moved on, or could not be removed: take the new copy back
    // out so the vault is not left holding the note twice.
    console.error('[vault rename] removing the old file', error instanceof Error ? error.message : error);
    try {
      await source.deleteNote(to, written.blobSha, `Undo ${message}`);
    } catch (undo) {
      console.error('[vault rename] taking the new file back out', undo instanceof Error ? undo.message : undo);
    }
    return failed(error instanceof VaultConflictError ? 'changed' : 'error');
  }

  const title = parseNote(text, to).title;
  try {
    await ports.moveNote(note.id, note.blobSha, { path: to, title, blobSha: written.blobSha });
  } catch (error) {
    // Both commits have landed, so the vault holds the new name and the next
    // sync stores it there.
    console.error('[vault rename] storing the new path', error instanceof Error ? error.message : error);
  }
  return { ok: true, path: to, title };
}
