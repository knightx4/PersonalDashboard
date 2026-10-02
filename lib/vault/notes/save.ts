import { MAX_NOTE_BYTES, parseNote, type ParsedNote } from '@/lib/vault/markdown/note';
import {
  VaultAuthError,
  VaultConflictError,
  VaultReadOnlyError,
  type VaultSource,
} from '@/lib/vault/providers/types';

/**
 * Saving an edited note back to the vault (plan #1424).
 *
 * The decisions live here and the database and repository sit behind ports,
 * so the order of things can be tested without either: the note is read again
 * on the person's own session, the stored blob is checked against the one the
 * editor opened, the new text is committed to the repository, and only then is
 * the stored note rewritten with the blob SHA the commit produced. That SHA is
 * what the sync compares, so the next sync sees nothing to do for this note.
 *
 * The editor holds the note's body, which is what the app stores: frontmatter
 * is parsed out on sync. The file is rebuilt from the blob the editor opened,
 * keeping its frontmatter block byte for byte and replacing only the body, so
 * an edit in the app never rewrites properties Obsidian wrote.
 */

/** The stored note, as the session client returns it. */
export type SavableNote = {
  id: string;
  path: string;
  title: string;
  body: string;
  blobSha: string;
};

/** What the stored note becomes once the commit has landed. */
export type SavedNoteRow = {
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  blobSha: string;
  sizeBytes: number;
  gitUpdatedAt: string;
};

export type SaveNotePorts = {
  /** The note at this path, read on the session client; null when it is not yours or gone. */
  loadNote(path: string): Promise<SavableNote | null>;
  /**
   * The vault the note belongs to, as a source that can write. 'none' when no
   * vault is connected, 'reauth' when the connection has no usable token.
   */
  openSource(): Promise<VaultSource | 'none' | 'reauth'>;
  /**
   * Rewrite the stored note. `expectedBlobSha` guards the update, so a sync
   * that rewrote the row in the meantime is not overwritten with older text.
   */
  storeNote(noteId: string, expectedBlobSha: string, row: SavedNoteRow): Promise<void>;
  /** The follow-up a synced edit gets (the note's embedding). Must not throw. */
  afterSave(noteId: string): void;
  now?: () => Date;
};

export type SaveNoteInput = {
  path: string;
  /** The new body, as the editor holds it. */
  text: string;
  /** The blob SHA the editor opened the note at. */
  expectedBlobSha: string;
};

export type SaveNoteFailure =
  /** Not in your vault: missing, deleted, or someone else's. */
  | 'not-found'
  /** The note changed since the editor opened it, in the app or in the repository. */
  | 'changed'
  /** The token reads the vault but cannot write to it. */
  | 'read-only'
  /** No vault connected, or its token was refused or is missing. */
  | 'reconnect'
  /** Over the size the app stores. */
  | 'too-large'
  /** Anything else: rate limit, network, a database write that failed. */
  | 'error';

export type SaveNoteResult =
  | {
      ok: true;
      /** The blob SHA the note is now at; the editor's next save starts from it. */
      blobSha: string;
      /** The commit the save made, null when nothing had changed. */
      commitSha: string | null;
    }
  | { ok: false; reason: SaveNoteFailure; detail: string };

/** The commit message a save writes, as the step asked. */
export function saveCommitMessage(title: string): string {
  return `Edit ${title} from Dash`;
}

/**
 * The file with its body replaced and its frontmatter left exactly as it was.
 *
 * parseNote's body is the tail of the raw file (gray-matter slices it, and
 * parseNote only trims leading newlines), so everything before it is the
 * frontmatter block and its separator. Null when that does not hold, so a
 * file the parser read some other way is never rebuilt by guesswork.
 */
export function withEditedBody(raw: string, path: string, body: string): string | null {
  const stored = parseNote(raw, path).body;
  if (!raw.endsWith(stored)) return null;
  return raw.slice(0, raw.length - stored.length) + body;
}

/**
 * A textarea submits its lines ending in CRLF. A file that used LF keeps LF,
 * or every line of it would show as changed in git.
 */
export function matchLineEndings(text: string, raw: string): string {
  if (raw.includes('\r\n')) return text.replace(/\r?\n/g, '\r\n');
  return text.replace(/\r\n/g, '\n');
}

function rowFrom(parsed: ParsedNote, blobSha: string, sizeBytes: number, now: Date): SavedNoteRow {
  return {
    title: parsed.title,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    blobSha,
    sizeBytes,
    // As the sync dates a note: its own frontmatter date first, else when it
    // was committed, which is now.
    gitUpdatedAt: parsed.updatedAt ?? now.toISOString(),
  };
}

function failed(reason: SaveNoteFailure, detail: string): SaveNoteResult {
  return { ok: false, reason, detail };
}

export async function saveNote(
  ports: SaveNotePorts,
  input: SaveNoteInput,
): Promise<SaveNoteResult> {
  const note = await ports.loadNote(input.path);
  if (!note) return failed('not-found', `No note at ${input.path} in this vault.`);

  // A sync has already brought in a newer version: refuse before asking the
  // repository, which would refuse too.
  if (note.blobSha !== input.expectedBlobSha) {
    return failed('changed', `${input.path} is at ${note.blobSha}, not ${input.expectedBlobSha}.`);
  }

  const source = await ports.openSource();
  if (source === 'none') return failed('reconnect', 'No vault is connected.');
  if (source === 'reauth') return failed('reconnect', 'The vault connection has no usable token.');

  try {
    const raw = await source.readBlob(input.expectedBlobSha);
    const body = matchLineEndings(input.text, raw);
    if (body === note.body) return { ok: true, blobSha: note.blobSha, commitSha: null };

    const text = withEditedBody(raw, note.path, body);
    if (text === null) {
      return failed('error', `Could not separate the frontmatter of ${note.path} from its body.`);
    }
    const sizeBytes = new TextEncoder().encode(text).byteLength;
    if (sizeBytes > MAX_NOTE_BYTES) {
      return failed('too-large', `${note.path} would be ${sizeBytes} bytes.`);
    }

    const written = await source.writeNote(
      note.path,
      text,
      input.expectedBlobSha,
      saveCommitMessage(note.title),
    );

    const now = ports.now?.() ?? new Date();
    try {
      await ports.storeNote(
        note.id,
        input.expectedBlobSha,
        rowFrom(parseNote(text, note.path), written.blobSha, sizeBytes, now),
      );
    } catch (storeError) {
      // The commit has landed, so the save happened: reporting a failure would
      // invite a retry the repository then refuses as stale. The next sync
      // sees the new blob and brings the stored note up to date.
      console.error(
        '[vault save] storing the saved note',
        storeError instanceof Error ? storeError.message : storeError,
      );
    }
    ports.afterSave(note.id);
    return { ok: true, blobSha: written.blobSha, commitSha: written.commitSha };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof VaultConflictError) return failed('changed', detail);
    if (error instanceof VaultReadOnlyError) return failed('read-only', detail);
    if (error instanceof VaultAuthError) return failed('reconnect', detail);
    return failed('error', detail);
  }
}
