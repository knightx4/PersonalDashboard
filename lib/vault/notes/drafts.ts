import { saveNote, type SaveNoteFailure, type SaveNotePorts } from './save';

/**
 * Edits made in the app wait as a draft before they go to the vault (note of
 * 20 October 2026; obsidian.note_drafts, vault migration 0040).
 *
 * The editor saves as you write, and a commit per pause left dozens of
 * commits for one sitting. So a pause writes a draft, which is quick and
 * makes no commit, and the note-drafts tick commits a draft once it has sat
 * for QUIET_MS untouched. The note's page shows the draft in the meantime, so
 * what you wrote is what you see.
 *
 * A draft is checked by its text rather than a version: a save says what it
 * last saw (`from`), and is refused when the note now holds something else.
 * That stays right across a commit made while the editor is open, which
 * moves the note's version on but leaves its text as the editor last saved.
 */

/** How long a draft sits untouched before it is committed. */
export const QUIET_MS = 10 * 60 * 1000;

/** Why a commit was refused, kept on the draft for the page to show. */
export type DraftFailure = Exclude<SaveNoteFailure, 'error'>;

export type NoteDraft = {
  noteId: string;
  body: string;
  baseBlobSha: string;
  updatedAt: string;
  failure: DraftFailure | null;
};

export type DraftNote = { id: string; body: string; blobSha: string };

export type DraftPorts = {
  /** The note at this path, read on the person's session; null when it is not theirs or gone. */
  loadNote(path: string): Promise<DraftNote | null>;
  loadDraft(noteId: string): Promise<NoteDraft | null>;
  /** A new draft, started from the note at `baseBlobSha`. */
  insertDraft(noteId: string, body: string, baseBlobSha: string): Promise<void>;
  /** New text for the draft, which clears any refusal and restarts the quiet time. */
  updateDraft(noteId: string, body: string): Promise<void>;
  deleteDraft(noteId: string): Promise<void>;
};

export type SaveDraftResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'changed' };

/**
 * Keep `text` as the note's draft. `from` is the text the editor last saved
 * or opened with; when the note holds something else now, it changed
 * somewhere else and the save is refused rather than written over it.
 */
export async function saveDraft(
  ports: DraftPorts,
  input: { path: string; text: string; from: string },
): Promise<SaveDraftResult> {
  const note = await ports.loadNote(input.path);
  if (!note) return { ok: false, reason: 'not-found' };
  const draft = await ports.loadDraft(note.id);
  const current = draft?.body ?? note.body;
  if (current !== input.from) return { ok: false, reason: 'changed' };
  if (input.text === current) return { ok: true };

  if (!draft) {
    await ports.insertDraft(note.id, input.text, note.blobSha);
  } else if (input.text === note.body && draft.baseBlobSha === note.blobSha) {
    // Typed back to what the vault holds: nothing is left to commit.
    await ports.deleteDraft(note.id);
  } else {
    await ports.updateDraft(note.id, input.text);
  }
  return { ok: true };
}

/** A draft due for its commit, as the tick reads it with the service client. */
export type DueDraft = {
  noteId: string;
  userId: string;
  path: string;
  body: string;
  baseBlobSha: string;
  updatedAt: string;
};

export type CommitDraftPorts = {
  /** Ports for saveNote on this person's vault. */
  savePorts(userId: string): SaveNotePorts;
  /** Drop the draft, unless it was edited after `updatedAt`. */
  clearDraft(draft: DueDraft): Promise<void>;
  /** The commit landed while the draft was being edited again: it now starts from `blobSha`. */
  rebaseDraft(draft: DueDraft, blobSha: string): Promise<void>;
  /** Keep why the commit was refused, unless the draft was edited after `updatedAt`. */
  refuseDraft(draft: DueDraft, failure: DraftFailure): Promise<void>;
};

export type CommitDraftResult = { ok: true; committed: boolean } | { ok: false; reason: SaveNoteFailure };

/**
 * Commit one draft to the vault and clear it. A refusal is kept on the draft;
 * any other failure leaves it waiting, to be tried on the next tick.
 */
export async function commitDraft(ports: CommitDraftPorts, draft: DueDraft): Promise<CommitDraftResult> {
  const result = await saveNote(ports.savePorts(draft.userId), {
    path: draft.path,
    text: draft.body,
    expectedBlobSha: draft.baseBlobSha,
  });
  if (!result.ok) {
    if (result.reason !== 'error') await ports.refuseDraft(draft, result.reason);
    return { ok: false, reason: result.reason };
  }
  await ports.clearDraft(draft);
  await ports.rebaseDraft(draft, result.blobSha);
  return { ok: true, committed: result.commitSha !== null };
}
