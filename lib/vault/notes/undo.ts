import { basenameOf, folderOf } from '@/lib/vault/paths';
import {
  createCapturedNote,
  removeCapturedNote,
  VAULT_WRITE_ERRORS,
  type CreateNotePorts,
  type RemoveNotePorts,
} from '@/lib/vault/notes/create';
import { renameNote, type RenameNotePorts } from '@/lib/vault/notes/rename';
import { saveNote, type SaveNotePorts } from '@/lib/vault/notes/save';

/**
 * Taking back a note Dash changed in the vault (plan #1894.9.3), from what its
 * record kept in core.dash_actions.undo.
 *
 * A note is a file in the notes repository, so its Undo is another commit, as
 * a captured note's is (create.ts): the generic rule, which only puts a row
 * back, cannot reach the file. Every write keeps `vault_blob_sha`, the blob
 * the note was left at, and every undo is refused once the note has moved on
 * from it, so later work in the app or in Obsidian is never thrown away.
 *
 *   remove   a note Dash wrote is taken out (no `vault_undo`, as before).
 *   restore  an edit: the body the note had is committed back.
 *   rename   a rename: the note goes back to its old name.
 *   unfile   a quick note filed: it comes back to the Inbox, then the note it
 *            went into gets its old body back, or the note it became is
 *            taken out.
 *
 * Ports as the writes use them, so the order is tested without either side.
 */

export type VaultUndo =
  | { kind: 'remove' }
  | { kind: 'restore'; body: string }
  | { kind: 'rename'; name: string }
  | { kind: 'unfile'; body: string | null; quick: { path: string; text: string } };

/** The columns of the record's `undo` this reads and the writes fill. */
export type VaultUndoRecord = {
  vault_blob_sha: string;
  vault_undo?: 'restore' | 'rename' | 'unfile';
  vault_body?: string;
  vault_name?: string;
  vault_quick_path?: string;
  vault_quick_text?: string;
};

/** The record's `undo` for one of these, as a write keeps it. */
export function vaultUndoRecord(blobSha: string, undo: VaultUndo): VaultUndoRecord {
  switch (undo.kind) {
    case 'remove':
      return { vault_blob_sha: blobSha };
    case 'restore':
      return { vault_blob_sha: blobSha, vault_undo: 'restore', vault_body: undo.body };
    case 'rename':
      return { vault_blob_sha: blobSha, vault_undo: 'rename', vault_name: undo.name };
    case 'unfile':
      return {
        vault_blob_sha: blobSha,
        vault_undo: 'unfile',
        ...(undo.body === null ? {} : { vault_body: undo.body }),
        vault_quick_path: undo.quick.path,
        vault_quick_text: undo.quick.text,
      };
  }
}

/** What the record kept, read back; null when it is not whole. */
export function readVaultUndo(undo: Record<string, unknown> | null | undefined): VaultUndo | null {
  if (!undo || typeof undo.vault_blob_sha !== 'string') return null;
  const body = typeof undo.vault_body === 'string' ? undo.vault_body : null;
  switch (undo.vault_undo) {
    case undefined:
    case null:
      return { kind: 'remove' };
    case 'restore':
      return body === null ? null : { kind: 'restore', body };
    case 'rename':
      return typeof undo.vault_name === 'string' && undo.vault_name ? { kind: 'rename', name: undo.vault_name } : null;
    case 'unfile':
      if (typeof undo.vault_quick_path !== 'string' || typeof undo.vault_quick_text !== 'string') return null;
      return { kind: 'unfile', body, quick: { path: undo.vault_quick_path, text: undo.vault_quick_text } };
    default:
      return null;
  }
}

export type VaultUndoPorts = {
  /** Reads the note by id, and commits its removal. */
  remove: RemoveNotePorts;
  /** Commits a body back. */
  save: SaveNotePorts;
  /** Moves a note back to its old name. */
  rename: RenameNotePorts;
  /** Writes a filed quick note back into the Inbox. */
  create: CreateNotePorts;
};

export type VaultUndoResult = { ok: true } | { ok: false; error: string };

const DELETED: VaultUndoResult = { ok: false, error: 'It has since been deleted, so there is nothing to undo.' };
const CHANGED: VaultUndoResult = {
  ok: false,
  error: 'It has changed since Dash wrote it, so undoing would lose the later change.',
};

/** The body put back on the note, while it is still at the blob Dash left it at. */
async function restoreBody(ports: VaultUndoPorts, noteId: string, blobSha: string, body: string): Promise<VaultUndoResult> {
  const note = await ports.remove.loadNote(noteId);
  if (!note || note.deleted) return DELETED;
  if (note.blobSha !== blobSha) return CHANGED;
  const saved = await saveNote(ports.save, { path: note.path, text: body, expectedBlobSha: blobSha });
  if (saved.ok) return { ok: true };
  if (saved.reason === 'changed') return CHANGED;
  if (saved.reason === 'not-found') return DELETED;
  if (saved.reason === 'read-only' || saved.reason === 'reconnect') return { ok: false, error: VAULT_WRITE_ERRORS[saved.reason] };
  console.error('[vault undo] putting the body back', saved.detail);
  return { ok: false, error: VAULT_WRITE_ERRORS.error };
}

/** The note back at its old name, while it is still at the blob Dash left it at. */
async function renameBack(ports: VaultUndoPorts, noteId: string, blobSha: string, name: string): Promise<VaultUndoResult> {
  const note = await ports.remove.loadNote(noteId);
  if (!note || note.deleted) return DELETED;
  if (note.blobSha !== blobSha) return CHANGED;
  const renamed = await renameNote(ports.rename, { path: note.path, name, expectedBlobSha: blobSha });
  if (renamed.ok) return { ok: true };
  if (renamed.reason === 'taken') return { ok: false, error: `Another note is called ${name} now, so it cannot have that name back.` };
  if (renamed.reason === 'same') return { ok: false, error: 'It has that name already, so there is nothing to undo.' };
  if (renamed.reason === 'changed') return CHANGED;
  if (renamed.reason === 'not-found') return DELETED;
  return { ok: false, error: renamed.error };
}

/** Put back what one vault write did. Never throws on a refusal; the sentence is the person's. */
export async function undoVaultWrite(
  ports: VaultUndoPorts,
  noteId: string,
  blobSha: string,
  undo: VaultUndo,
): Promise<VaultUndoResult> {
  switch (undo.kind) {
    case 'remove':
      return removeCapturedNote(ports.remove, noteId, blobSha);
    case 'restore':
      return restoreBody(ports, noteId, blobSha, undo.body);
    case 'rename':
      return renameBack(ports, noteId, blobSha, undo.name);
    case 'unfile': {
      // Checked before anything is written, so a refusal leaves both notes as they are.
      const note = await ports.remove.loadNote(noteId);
      if (!note || note.deleted) return DELETED;
      if (note.blobSha !== blobSha) return CHANGED;

      // The quick note comes back first, so the text is never in neither place.
      const back = await createCapturedNote(
        ports.create,
        undo.quick.text,
        basenameOf(undo.quick.path),
        folderOf(undo.quick.path),
        1,
      );
      if (!back.ok) {
        return {
          ok: false,
          error:
            back.reason === 'error'
              ? `The quick note could not go back into your Inbox, perhaps because a note there has its name now. Nothing was changed.`
              : back.error,
        };
      }
      const taken =
        undo.body === null
          ? await removeCapturedNote(ports.remove, noteId, blobSha)
          : await restoreBody(ports, noteId, blobSha, undo.body);
      if (!taken.ok) {
        // Take the copy back out, so the text is not left in two places.
        const out = await removeCapturedNote(ports.remove, back.noteId, back.blobSha);
        if (!out.ok) console.error('[vault undo] taking the quick note back out', out.error);
        return taken;
      }
      return { ok: true };
    }
  }
}
