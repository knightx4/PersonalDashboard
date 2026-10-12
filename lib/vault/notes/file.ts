import { INBOX_FOLDER } from '@/lib/vault/paths';
import {
  createCapturedNote,
  removeCapturedNote,
  VAULT_WRITE_ERRORS,
  type CreateNotePorts,
  type RemoveNotePorts,
} from '@/lib/vault/notes/create';
import { saveNote, type SaveNoteFailure, type SaveNotePorts } from '@/lib/vault/notes/save';

/**
 * Filing a quick note out of the Inbox (plan #1728, feature #1726).
 *
 * A quick note is a note in the vault's Inbox folder, and it leaves triage
 * when it leaves that folder. Filing does one of two things with it:
 *
 * - **into a note**: its text is added to the bottom of the chosen note under
 *   a dated line, through the same save an edit uses (save.ts), which refuses
 *   a note changed in Obsidian since it was read;
 * - **as a note of its own**: it is written as a new note at the top of the
 *   vault, named from its first line as capture names one (create.ts).
 *
 * Either way the Inbox file is removed only after the text is committed in
 * its new place, so a failure at any point leaves the text somewhere: in the
 * Inbox if the write was refused, in both places if the removal was. The
 * removed file stays in the repository's history.
 *
 * The database and repository sit behind the same ports as save and create,
 * so the order is tested without either.
 */

export type FileQuickNotePorts = {
  /** Reads the quick note and the target by path, and saves the target. */
  save: SaveNotePorts;
  /** Writes a quick note out as a note of its own. */
  create: CreateNotePorts;
  /** Takes the Inbox file out once the text is safe. */
  remove: RemoveNotePorts;
  now?: () => Date;
};

export type FileQuickNoteInput = {
  /** The quick note's path, in the Inbox folder. */
  quickPath: string;
  /**
   * The blob SHA the quick note was shown at. When given, a quick note edited
   * since is refused, so what is filed is what the person read.
   */
  quickBlobSha?: string;
  target:
    | {
        kind: 'note';
        path: string;
        /** The blob SHA the target was shown at; defaults to the stored one. */
        blobSha?: string;
      }
    | { kind: 'own' };
};

export type FileQuickNoteFailure =
  | 'not-quick'
  | 'quick-changed'
  | 'same-note'
  | SaveNoteFailure;

export type FileQuickNoteResult =
  | {
      ok: true;
      /** Where the text is now. */
      path: string;
      title: string;
      /** False when the text was filed but the Inbox file could not be removed. */
      removed: boolean;
      /** What the person reads when `removed` is false. */
      warning?: string;
    }
  | { ok: false; reason: FileQuickNoteFailure; error: string };

/** What the person reads when filing does not go through. Nothing has moved in any of them. */
export const FILE_ERRORS: Record<FileQuickNoteFailure, string> = {
  'not-quick': 'That quick note is no longer in your Inbox.',
  'quick-changed': 'That quick note changed since you opened it. Look at it again before filing it.',
  'same-note': 'A quick note cannot be added to itself.',
  'not-found': 'That note is not in the vault any more. Pick another.',
  changed:
    'That note changed since Dash last read it, perhaps in Obsidian. Wait for the next sync and try again. The quick note is still in your Inbox.',
  'read-only': VAULT_WRITE_ERRORS['read-only'],
  reconnect: VAULT_WRITE_ERRORS.reconnect,
  'too-large': 'Adding this would make that note too long to keep. The quick note is still in your Inbox.',
  error: 'The quick note could not be filed. Try again in a moment. It is still in your Inbox.',
};

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The line a filed quick note sits under: "*Added 10 October 2026*". */
export function filedLine(now: Date): string {
  return `*Added ${DAY.format(now)}*`;
}

/**
 * The target's body with the quick note at its foot: one blank line, the
 * dated line, one blank line, the text. Trailing space on either is dropped
 * and the result ends in one newline.
 */
export function appendQuickNote(body: string, text: string, now: Date): string {
  const head = body.replace(/\s+$/, '');
  const tail = `${filedLine(now)}\n\n${text.replace(/\r\n/g, '\n').trim()}\n`;
  return head ? `${head}\n\n${tail}` : tail;
}

export function isInInbox(path: string): boolean {
  return path.startsWith(`${INBOX_FOLDER}/`);
}

function failed(reason: FileQuickNoteFailure): FileQuickNoteResult {
  return { ok: false, reason, error: FILE_ERRORS[reason] };
}

export async function fileQuickNote(
  ports: FileQuickNotePorts,
  input: FileQuickNoteInput,
): Promise<FileQuickNoteResult> {
  if (!isInInbox(input.quickPath)) return failed('not-quick');
  const quick = await ports.save.loadNote(input.quickPath);
  if (!quick) return failed('not-quick');
  if (input.quickBlobSha && quick.blobSha !== input.quickBlobSha) return failed('quick-changed');

  let placed: { path: string; title: string };
  if (input.target.kind === 'note') {
    if (input.target.path === quick.path) return failed('same-note');
    const target = await ports.save.loadNote(input.target.path);
    if (!target) return failed('not-found');
    const now = ports.now?.() ?? new Date();
    const saved = await saveNote(ports.save, {
      path: target.path,
      text: appendQuickNote(target.body, quick.body, now),
      expectedBlobSha: input.target.blobSha ?? target.blobSha,
    });
    if (!saved.ok) {
      if (saved.reason === 'error') console.error('[vault file] saving the target', saved.detail);
      return failed(saved.reason);
    }
    placed = { path: target.path, title: target.title };
  } else {
    const created = await createCapturedNote(ports.create, quick.body, undefined, '');
    if (!created.ok) return { ok: false, reason: created.reason, error: created.error };
    placed = { path: created.path, title: created.title };
  }

  // The text is committed in its new place. Only now does the Inbox file go.
  const removed = await removeCapturedNote(ports.remove, quick.id, quick.blobSha);
  if (!removed.ok) {
    console.error('[vault file] removing the quick note', removed.error);
    return {
      ...placed,
      ok: true,
      removed: false,
      warning: `The text is in ${placed.title} now, but the quick note could not be taken out of your Inbox. Delete it there yourself, or it will be filed twice.`,
    };
  }
  return { ...placed, ok: true, removed: true };
}
