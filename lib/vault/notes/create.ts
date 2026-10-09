import { MAX_NOTE_BYTES, parseNote } from '@/lib/vault/markdown/note';
import { INBOX_FOLDER } from '@/lib/vault/paths';
import {
  VaultAuthError,
  VaultConflictError,
  VaultReadOnlyError,
  type VaultSource,
} from '@/lib/vault/providers/types';

/**
 * Writing a new note into the vault from capture, and taking it out again
 * (plan #1582, feature #1579; decision #1583 answered A).
 *
 * A sentence the capture box files as a note goes into the vault's Inbox
 * folder, named from its first line, as a commit to the notes repository.
 * Once the commit lands the note is stored with the blob SHA it produced,
 * as saving an edit does (lib/vault/notes/save.ts), so the next sync finds
 * nothing to do and Obsidian shows the note the next time it pulls.
 *
 * Undo is a second commit removing the file, refused when the note has been
 * edited since, and then the stored note is marked deleted as the sync marks
 * a file removed in the repository.
 *
 * The database and the repository sit behind ports, so this is tested without
 * either; lib/vault/db/ports.ts binds them to the person's session.
 */


/** Longest file name taken from a note's first line, before `.md`. */
const NAME_MAX = 60;
/** How many names are tried when a file is already at the first. */
const NAME_ATTEMPTS = 5;

/** Characters Obsidian refuses in a file name, or that break a link to it. */
const UNSAFE = /[\\/:*?"<>|#^[\]]/g;

/**
 * The note's name, from its first line: markdown markers dropped, characters
 * a file name cannot hold removed, and cut at a word to sixty characters.
 * When nothing is left, it is named by the day it was captured.
 */
export function inboxNoteName(text: string, now: Date): string {
  const first = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const name = first
    .replace(/^\s*(?:#+|[-*+>]|\d+[.)])\s+/, '')
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  if (!name) return `Capture ${now.toISOString().slice(0, 10)}`;
  if (name.length <= NAME_MAX) return name;
  const cut = name.slice(0, NAME_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > NAME_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

/** The vault path for a name, numbered from the second attempt: "Inbox/Idea 2.md". */
export function inboxNotePath(name: string, attempt = 1): string {
  return `${INBOX_FOLDER}/${attempt > 1 ? `${name} ${attempt}` : name}.md`;
}

export function createCommitMessage(title: string): string {
  return `Add ${title} from Dash`;
}

export function removeCommitMessage(title: string): string {
  return `Remove ${title} from Dash`;
}

/** The note as it is stored once its commit has landed. */
export type NewNoteRow = {
  path: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  blobSha: string;
  sizeBytes: number;
  gitUpdatedAt: string;
};

/** A stored note, as Undo reads it. */
export type StoredNote = {
  id: string;
  path: string;
  title: string;
  blobSha: string;
  deleted: boolean;
};

export type CreateNotePorts = {
  /** The connected vault as a source that can write; 'none' or 'reauth' when there is none. */
  openSource(): Promise<VaultSource | 'none' | 'reauth'>;
  /** Store the new note, or bring back a deleted one at the same path. Returns its id. */
  storeNote(row: NewNoteRow): Promise<string>;
  /** The follow-up a written note gets (its embedding). Must not throw. */
  afterSave(noteId: string): void;
  now?: () => Date;
};

export type RemoveNotePorts = {
  openSource(): Promise<VaultSource | 'none' | 'reauth'>;
  /** The stored note by id, read on the person's session; null when it is not theirs. */
  loadNote(noteId: string): Promise<StoredNote | null>;
  /** Mark it deleted, only while it is still at `blobSha`. */
  markDeleted(noteId: string, blobSha: string): Promise<void>;
};

export type VaultWriteFailure = 'read-only' | 'reconnect' | 'too-large' | 'error';

export type CreateNoteResult =
  | { ok: true; noteId: string; path: string; title: string; blobSha: string; commitSha: string }
  | { ok: false; reason: VaultWriteFailure; error: string };

/** What the person reads when the vault cannot be written. */
export const VAULT_WRITE_ERRORS: Record<VaultWriteFailure, string> = {
  'read-only': 'Your vault token can read notes but not write them. Add one that can write in vault settings.',
  reconnect: 'Your vault needs reconnecting before Dash can write notes into it.',
  'too-large': 'That is too long to keep as a note.',
  error: 'The note could not be written to your vault. Try again in a moment.',
};

function failure(error: unknown): VaultWriteFailure {
  if (error instanceof VaultReadOnlyError) return 'read-only';
  if (error instanceof VaultAuthError) return 'reconnect';
  return 'error';
}

/**
 * Commit `text` as a new note in the Inbox folder and store it. A file
 * already at the name is never written over: the next number is tried.
 * The note is named from its first line, or from `title` when one is given,
 * as the vault's New note gives one (note 09ff8039).
 */
export async function createCapturedNote(
  ports: CreateNotePorts,
  text: string,
  title?: string,
): Promise<CreateNoteResult> {
  const now = ports.now?.() ?? new Date();
  const content = `${text.replace(/\r\n/g, '\n').trim()}\n`;
  const sizeBytes = new TextEncoder().encode(content).byteLength;
  if (sizeBytes > MAX_NOTE_BYTES) return { ok: false, reason: 'too-large', error: VAULT_WRITE_ERRORS['too-large'] };

  let source: VaultSource | 'none' | 'reauth';
  try {
    source = await ports.openSource();
  } catch (error) {
    console.error('[vault capture] opening the vault', error instanceof Error ? error.message : error);
    return { ok: false, reason: 'error', error: VAULT_WRITE_ERRORS.error };
  }
  if (source === 'none' || source === 'reauth') {
    return { ok: false, reason: 'reconnect', error: VAULT_WRITE_ERRORS.reconnect };
  }

  const name = inboxNoteName(title?.trim() ? title : content, now);
  for (let attempt = 1; attempt <= NAME_ATTEMPTS; attempt += 1) {
    const path = inboxNotePath(name, attempt);
    const parsed = parseNote(content, path);
    let written: { blobSha: string; commitSha: string };
    try {
      written = await source.createNote(path, content, createCommitMessage(parsed.title));
    } catch (error) {
      if (error instanceof VaultConflictError) continue;
      const reason = failure(error);
      console.error('[vault capture] writing the note', error instanceof Error ? error.message : error);
      return { ok: false, reason, error: VAULT_WRITE_ERRORS[reason] };
    }

    try {
      const noteId = await ports.storeNote({
        path,
        title: parsed.title,
        body: parsed.body,
        frontmatter: parsed.frontmatter,
        blobSha: written.blobSha,
        sizeBytes,
        gitUpdatedAt: parsed.updatedAt ?? now.toISOString(),
      });
      ports.afterSave(noteId);
      return { ok: true, noteId, path, title: parsed.title, ...written };
    } catch (error) {
      // The commit has landed, so the note is in the vault and the next sync
      // stores it. Without a stored row there is nothing for Undo to hold.
      console.error('[vault capture] storing the note', error instanceof Error ? error.message : error);
      return {
        ok: false,
        reason: 'error',
        error: 'The note is in your vault, but Dash could not show it here yet. It appears after the next sync.',
      };
    }
  }
  return {
    ok: false,
    reason: 'error',
    error: `Your Inbox already has notes called "${name}". Rename one and try again.`,
  };
}

export type RemoveNoteResult = { ok: true } | { ok: false; error: string };

/**
 * Undo a note capture wrote: commit its removal and mark the stored note
 * deleted. Refused, with the sentence the person reads, once the note has
 * been edited or removed since, so later work is never thrown away.
 */
export async function removeCapturedNote(
  ports: RemoveNotePorts,
  noteId: string,
  writtenBlobSha: string,
): Promise<RemoveNoteResult> {
  const note = await ports.loadNote(noteId);
  if (!note || note.deleted) return { ok: false, error: 'It has since been deleted, so there is nothing to undo.' };
  const changed = { ok: false as const, error: 'It has changed since Dash wrote it, so undoing would lose the later change.' };
  if (note.blobSha !== writtenBlobSha) return changed;

  const source = await ports.openSource();
  if (source === 'none' || source === 'reauth') return { ok: false, error: VAULT_WRITE_ERRORS.reconnect };
  try {
    await source.deleteNote(note.path, note.blobSha, removeCommitMessage(note.title));
  } catch (error) {
    if (error instanceof VaultConflictError) return changed;
    console.error('[vault capture] removing the note', error instanceof Error ? error.message : error);
    return { ok: false, error: VAULT_WRITE_ERRORS[failure(error)] };
  }
  try {
    await ports.markDeleted(note.id, note.blobSha);
  } catch (error) {
    // The removal is committed, so the undo happened; the next sync marks
    // the stored note deleted from the same commit.
    console.error('[vault capture] marking the note deleted', error instanceof Error ? error.message : error);
  }
  return { ok: true };
}
