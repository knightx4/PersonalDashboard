import { MAX_NOTE_BYTES, parseNote } from '@/lib/vault/markdown/note';
import {
  createCapturedNote,
  inboxNoteName,
  removeCapturedNote,
  VAULT_WRITE_ERRORS,
  type CreateNotePorts,
  type RemoveNotePorts,
  type VaultWriteFailure,
} from '@/lib/vault/notes/create';
import {
  matchLineEndings,
  saveCommitMessage,
  saveNote,
  withEditedBody,
  type SavableNote,
  type SaveNoteFailure,
  type SaveNotePorts,
} from '@/lib/vault/notes/save';
import {
  findQuickSection,
  isOldTriageList,
  newQuickSectionId,
  parseQuickSections,
  quickSectionFingerprint,
  quickSectionHeading,
  withoutQuickSection,
  withQuickSections,
} from '@/lib/vault/notes/quick-sections';
import { basenameOf, folderOf, INBOX_FOLDER, TRIAGE_NOTE_PATH, TRIAGE_NOTE_TITLE } from '@/lib/vault/paths';
import { VaultAuthError, VaultConflictError, VaultReadOnlyError } from '@/lib/vault/providers/types';

/**
 * Writing quick notes into Quick note triage and taking them out (plan
 * #3063). Every quick note, from the capture box, the Vault page, Dash, the
 * bots or the connector, is a section of the one note at TRIAGE_NOTE_PATH
 * (quick-sections.ts has the shape), so the vault and Obsidian hold one note
 * where they used to hold a file per thought.
 *
 * Every change goes through the ordinary save (save.ts), which commits only
 * over the blob the app last stored. When that is refused:
 *
 * - another write in the app moved the stored note on: the change is made
 *   again over the new text;
 * - the note was changed in Obsidian since the last sync: the file is read
 *   from the repository as it is now, the change is made over that, and the
 *   commit goes over that blob. What the person wrote in Obsidian is kept.
 *
 * Ports as save and create use them, so all of it is tested without a vault.
 */

export type QuickNotePorts = {
  save: SaveNotePorts;
  create: CreateNotePorts;
  /** The person's zone, for the heading's day and time; UTC when not given. */
  timeZone?: string;
  now?: () => Date;
};

export type QuickNoteFailure = 'not-quick' | 'quick-changed' | SaveNoteFailure;

/** What the person reads when a quick note cannot be added or taken out. Nothing has moved. */
export const QUICK_NOTE_ERRORS: Record<QuickNoteFailure, string> = {
  'not-quick': 'That quick note is no longer in Quick note triage.',
  'quick-changed': 'That quick note changed since you opened it. Look at it again first.',
  'not-found': 'Quick note triage is not in the vault any more.',
  changed: 'Quick note triage kept changing while Dash wrote to it. Try again in a moment.',
  'read-only': VAULT_WRITE_ERRORS['read-only'],
  reconnect: VAULT_WRITE_ERRORS.reconnect,
  'too-large': 'Quick note triage would be too long to keep. File a few quick notes first.',
  error: 'Quick note triage could not be written. Try again in a moment.',
};

type Change<R> = (body: string) => { body: string; result: R } | { refuse: QuickNoteFailure };

export type TriageWrite<R> =
  | { ok: true; noteId: string; blobSha: string; result: R }
  | { ok: false; reason: QuickNoteFailure; error: string };

function failed(reason: QuickNoteFailure): { ok: false; reason: QuickNoteFailure; error: string } {
  return { ok: false, reason, error: QUICK_NOTE_ERRORS[reason] };
}

function writeFailure(error: unknown): QuickNoteFailure {
  if (error instanceof VaultConflictError) return 'changed';
  if (error instanceof VaultReadOnlyError) return 'read-only';
  if (error instanceof VaultAuthError) return 'reconnect';
  return 'error';
}

/** How many times a change is made again over a note that moved under it. */
const ATTEMPTS = 3;

/**
 * The change made over the file as the repository holds it now, for a note
 * changed in Obsidian since the last sync. 'retry' when it moved again
 * meanwhile.
 */
async function changeInRepository<R>(
  ports: SaveNotePorts,
  stored: SavableNote,
  change: Change<R>,
): Promise<TriageWrite<R> | 'retry'> {
  const source = await ports.openSource();
  if (source === 'none' || source === 'reauth') return failed('reconnect');
  try {
    const snapshot = await source.snapshot(await source.headCommit());
    // The snapshot lists repository paths; the vault may be a folder of the repository.
    const entry = snapshot.entries
      .filter((e) => e.path === TRIAGE_NOTE_PATH || e.path.endsWith(`/${TRIAGE_NOTE_PATH}`))
      .sort((a, b) => a.path.length - b.path.length)[0];
    if (!entry) return failed('not-found');
    if (entry.blobSha === stored.blobSha) return failed('changed');

    const raw = await source.readBlob(entry.blobSha);
    const next = change(parseNote(raw, TRIAGE_NOTE_PATH).body);
    if ('refuse' in next) return failed(next.refuse);
    const text = withEditedBody(raw, TRIAGE_NOTE_PATH, matchLineEndings(next.body, raw));
    if (text === null) return failed('error');
    const sizeBytes = new TextEncoder().encode(text).byteLength;
    if (sizeBytes > MAX_NOTE_BYTES) return failed('too-large');

    const written = await source.writeNote(TRIAGE_NOTE_PATH, text, entry.blobSha, saveCommitMessage(stored.title));
    const parsed = parseNote(text, TRIAGE_NOTE_PATH);
    try {
      await ports.storeNote(stored.id, stored.blobSha, {
        title: parsed.title,
        body: parsed.body,
        frontmatter: parsed.frontmatter,
        blobSha: written.blobSha,
        sizeBytes,
        gitUpdatedAt: parsed.updatedAt ?? (ports.now?.() ?? new Date()).toISOString(),
      });
    } catch (error) {
      // The commit has landed; the next sync stores it.
      console.error('[quick notes] storing the merged note', error instanceof Error ? error.message : error);
    }
    return { ok: true, noteId: stored.id, blobSha: written.blobSha, result: next.result };
  } catch (error) {
    if (error instanceof VaultConflictError) return 'retry';
    console.error('[quick notes] merging with the repository', error instanceof Error ? error.message : error);
    return failed(writeFailure(error));
  }
}

/**
 * Make one change to Quick note triage, committed. `create` makes the note
 * when there is none; without it, no note means no quick note to act on.
 */
export async function changeTriageNote<R>(
  ports: { save: SaveNotePorts; create: CreateNotePorts },
  change: Change<R>,
  options: { create: boolean },
): Promise<TriageWrite<R>> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const existing = await ports.save.loadNote(TRIAGE_NOTE_PATH);
    if (!existing) {
      if (!options.create) return failed('not-quick');
      const next = change('');
      if ('refuse' in next) return failed(next.refuse);
      // One name only: a numbered "Quick note triage 2" would be a second triage note.
      const created = await createCapturedNote(ports.create, next.body, TRIAGE_NOTE_TITLE, '', 1);
      if (created.ok) return { ok: true, noteId: created.noteId, blobSha: created.blobSha, result: next.result };
      return { ok: false, reason: created.reason as VaultWriteFailure, error: created.error };
    }

    const next = change(existing.body);
    if ('refuse' in next) return failed(next.refuse);
    if (next.body === existing.body) return { ok: true, noteId: existing.id, blobSha: existing.blobSha, result: next.result };

    const saved = await saveNote(ports.save, { path: TRIAGE_NOTE_PATH, text: next.body, expectedBlobSha: existing.blobSha });
    if (saved.ok) return { ok: true, noteId: existing.id, blobSha: saved.blobSha, result: next.result };
    if (saved.reason !== 'changed') {
      if (saved.reason === 'error') console.error('[quick notes] saving Quick note triage', saved.detail);
      return failed(saved.reason);
    }

    // Refused as changed. Another write here moved the stored note on: go again over it.
    const now = await ports.save.loadNote(TRIAGE_NOTE_PATH);
    if (now && now.blobSha !== existing.blobSha) continue;
    // The stored note is as it was, so the file moved on in the repository: Obsidian.
    const merged = await changeInRepository(ports.save, existing, change);
    if (merged !== 'retry') return merged;
  }
  return failed('changed');
}

export type AddedQuickNote = {
  ok: true;
  /** Quick note triage's id, path and blob once the section is in. */
  noteId: string;
  path: string;
  blobSha: string;
  /** The name the quick note would have as a note of its own, from its first line. */
  title: string;
  section: { id: string; capturedAt: string; text: string };
};

/** Add one quick note as a section at the foot of Quick note triage. */
export async function addQuickNote(
  ports: QuickNotePorts,
  text: string,
): Promise<AddedQuickNote | { ok: false; reason: QuickNoteFailure; error: string }> {
  const body = text.replace(/\r\n/g, '\n').trim();
  const now = ports.now?.() ?? new Date();
  const section = {
    id: newQuickSectionId(now),
    capturedAt: now.toISOString(),
    heading: quickSectionHeading(now, ports.timeZone ?? 'UTC'),
    text: body,
  };
  const written = await changeTriageNote(ports, (current) => ({ body: withQuickSections(current, [section]), result: null }), {
    create: true,
  });
  if (!written.ok) return written;
  return {
    ok: true,
    noteId: written.noteId,
    path: TRIAGE_NOTE_PATH,
    blobSha: written.blobSha,
    title: inboxNoteName(body, now),
    section: { id: section.id, capturedAt: section.capturedAt, text: body },
  };
}

/**
 * Take one section out of Quick note triage. With `fingerprint`
 * (quickSectionFingerprint of the text that was shown), a section edited
 * since is refused, so what goes is what the person read.
 */
export async function removeQuickSection(
  ports: { save: SaveNotePorts; create: CreateNotePorts },
  id: string,
  fingerprint?: string,
): Promise<TriageWrite<null>> {
  return changeTriageNote<null>(
    ports,
    (current) => {
      const section = findQuickSection(current, id);
      if (!section) return { refuse: 'not-quick' };
      if (fingerprint && quickSectionFingerprint(section.text) !== fingerprint) return { refuse: 'quick-changed' };
      return { body: withoutQuickSection(current, id) ?? current, result: null };
    },
    { create: false },
  );
}

/** Put a section back where Undo found it gone: at the foot, with its own id and time. */
export async function restoreQuickSection(
  ports: QuickNotePorts,
  section: { id: string; capturedAt: string; text: string },
): Promise<TriageWrite<null>> {
  const at = new Date(section.capturedAt);
  const heading = quickSectionHeading(Number.isNaN(at.getTime()) ? new Date() : at, ports.timeZone ?? 'UTC');
  return changeTriageNote<null>(
    ports,
    (current) =>
      findQuickSection(current, section.id)
        ? { body: current, result: null }
        : { body: withQuickSections(current, [{ ...section, heading }]), result: null },
    { create: true },
  );
}

// ---------------------------------------------------------------------------
// Folding the old files in
// ---------------------------------------------------------------------------

/** A note in the Inbox, as the fold reads it. */
export type InboxFile = { id: string; path: string; body: string; blobSha: string; writtenAt: string | null };

const NUMBERED = / \d+$/;

/**
 * True for a file that is a quick note from before #3063: at the top of the
 * Inbox, named from its own first line as capture named one (inboxNoteName,
 * with the number a second note of the same name got). A note the person or
 * Dash gave a title of its own, such as "Board meeting 25 Oct 2026", is a
 * note they keep in the Inbox and is left where it is.
 */
export function isQuickNoteFile(path: string, body: string): boolean {
  if (folderOf(path) !== INBOX_FOLDER) return false;
  const name = basenameOf(path);
  const fromText = inboxNoteName(body, new Date(0));
  // A note with no words to name it by was named for the day it was captured.
  if (fromText.startsWith('Capture ')) return /^Capture \d{4}-\d{2}-\d{2}(?: \d+)?$/.test(name);
  return name === fromText || (NUMBERED.test(name) && name.replace(NUMBERED, '') === fromText);
}

export type FoldResult = { folded: number; removed: number; failed: number; error?: string };

/**
 * Fold the quick notes still kept as files into sections of Quick note
 * triage, oldest first, each under the day it was written, and then take
 * the files out. A file is removed only once its text is committed in the
 * note, and only while it is still at the blob it was read at, so a file
 * edited meanwhile stays. A file already folded keeps the section it made
 * (the id is the file's own), so folding twice adds nothing twice.
 */
export async function foldQuickNoteFiles(
  ports: QuickNotePorts & { remove: RemoveNotePorts },
  inbox: readonly InboxFile[],
): Promise<FoldResult> {
  const files = inbox
    .filter((file) => isQuickNoteFile(file.path, file.body))
    .sort((a, b) => (a.writtenAt ?? '').localeCompare(b.writtenAt ?? '') || a.path.localeCompare(b.path));
  if (files.length === 0) return { folded: 0, removed: 0, failed: 0 };

  const zone = ports.timeZone ?? 'UTC';
  const now = ports.now?.() ?? new Date();
  const sections = files.map((file) => {
    const parsed = file.writtenAt ? new Date(file.writtenAt) : null;
    const at = parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
    return {
      fileId: file.id,
      blobSha: file.blobSha,
      id: newQuickSectionId(at, file.id),
      capturedAt: at.toISOString(),
      heading: quickSectionHeading(at, zone),
      text: file.body.replace(/\r\n/g, '\n').trim(),
    };
  });

  const written = await changeTriageNote(
    ports,
    (current) => {
      const have = new Set(parseQuickSections(current).map((section) => section.id));
      const adding = sections.filter((section) => !have.has(section.id));
      // The old list is rewritten even when every file is already in.
      if (adding.length === 0 && !isOldTriageList(current)) return { body: current, result: 0 };
      return { body: withQuickSections(current, adding), result: adding.length };
    },
    { create: true },
  );
  if (!written.ok) return { folded: 0, removed: 0, failed: files.length, error: written.error };

  let removed = 0;
  let failedCount = 0;
  for (const section of sections) {
    const out = await removeCapturedNote(ports.remove, section.fileId, section.blobSha);
    if (out.ok) removed += 1;
    else {
      failedCount += 1;
      console.error('[quick notes] removing a folded file', section.fileId, out.error);
    }
  }
  return { folded: written.result, removed, failed: failedCount };
}
