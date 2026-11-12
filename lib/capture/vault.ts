import 'server-only';

import { after } from 'next/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { forgetFiles, markDashActionUndone, type DashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import { parseRef } from '@/lib/core/refs';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import {
  noteCreatePorts,
  noteRemovePorts,
  noteRenamePorts,
  noteSavePorts,
  openConnectedSource,
  quickNotePorts,
} from '@/lib/vault/db/ports';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { createCapturedNote, type CreateNotePorts } from '@/lib/vault/notes/create';
import { loadInboxNotes } from '@/lib/vault/notes/load';
import { addQuickNote, foldQuickNoteFiles, isQuickNoteFile, type FoldResult } from '@/lib/vault/notes/quick-notes';
import { readVaultUndo, undoVaultWrite, vaultUndoRecord } from '@/lib/vault/notes/undo';
import { embedVaultNotes } from '@/lib/vault/notes/embed';
import { checkWriteAccess, type WriteAccess } from '@/lib/vault/notes/write-access';
import type { SaveNotePorts } from '@/lib/vault/notes/save';

/**
 * The vault, as a place the one capture box files into (plan #1582, feature
 * #1579): whether it is offered, writing a note into its Inbox, and Undo.
 *
 * The decisions are in lib/vault/notes/create.ts; this binds them to the
 * signed-in person's session, as the note page's save does.
 */

/** How long a write-access answer is kept. GitHub is asked at most this often. */
const ACCESS_TTL_MS = 10 * 60_000;
const ACCESS = new Map<string, { at: number; access: WriteAccess }>();

/**
 * Whether the vault is offered: true only while its token can write. Asked of
 * GitHub with a write that cannot succeed (canWrite), and kept for ten
 * minutes; an answer GitHub did not give is not kept, and offers nothing.
 */
export async function vaultWritable(userId: string): Promise<boolean> {
  const held = ACCESS.get(userId);
  if (held && Date.now() - held.at < ACCESS_TTL_MS) return held.access === 'yes';
  try {
    const supabase = await createVaultClient();
    const access = await checkWriteAccess(() => openConnectedSource(supabase));
    if (access !== 'unknown') ACCESS.set(userId, { at: Date.now(), access });
    return access === 'yes';
  } catch (error) {
    console.error('capture: could not check vault write access', error);
    return false;
  }
}

/** How long the embedding after a note is written may run, as after a save. */
const EMBED_AFTER_WRITE_MS = 20_000;

/** The embedding a written note gets once the reply has gone, as after a save. */
function embedAfter(supabase: VaultSupabaseClient, userId: string): (noteId: string) => void {
  return () => {
    after(async () => {
      try {
        await embedVaultNotes(supabase, await createCoreClient(), {
          userId,
          deadline: Date.now() + EMBED_AFTER_WRITE_MS,
        });
      } catch (error) {
        console.error('[vault capture] note embedding', error instanceof Error ? error.message : error);
      }
    });
  };
}

function inboxPorts(supabase: VaultSupabaseClient, userId: string): CreateNotePorts {
  return noteCreatePorts({ supabase, afterSave: embedAfter(supabase, userId) });
}

/**
 * The ports a quick note is written with on the signed-in person's vault:
 * what Ask hands add_quick_note, which adds a section to Quick note triage
 * as the Vault page's quick note does (plan #3063).
 */
export async function sessionInboxPorts(userId: string): Promise<{ save: SaveNotePorts; create: CreateNotePorts }> {
  const supabase = await createVaultClient();
  return quickNotePorts({ supabase, afterSave: embedAfter(supabase, userId) });
}

/** The person's zone, for a quick note's heading; UTC when it cannot be read. */
async function zoneOf(userId: string): Promise<string> {
  try {
    return (await loadAccountSettings(userId)).timezone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Write a note file into the vault's Inbox, as the signed-in person: the
 * vault page's New note, and an answer of Dash's saved with a title. A quick
 * note is not a file: it is addVaultQuickNote.
 */
export async function fileVaultNote(
  userId: string,
  text: string,
  title?: string,
): Promise<{ ok: true; noteId: string; path: string; title: string; blobSha: string } | { ok: false; error: string }> {
  const supabase = await createVaultClient();
  const result = await createCapturedNote(inboxPorts(supabase, userId), text, title);
  if (!result.ok) {
    // The token stopped writing since it was checked: stop offering the vault.
    if (result.reason === 'read-only' || result.reason === 'reconnect') ACCESS.delete(userId);
    return { ok: false, error: result.error };
  }
  return { ok: true, noteId: result.noteId, path: result.path, title: result.title, blobSha: result.blobSha };
}

/**
 * Add a quick note as a section of Quick note triage, as the signed-in
 * person (plan #3063): the capture box, the Vault page's Add a quick note
 * and an answer of Dash's saved as a quick note. No file is made; `noteId`
 * and `path` are Quick note triage's, and `undo` is what the record keeps
 * so Undo takes out this section alone.
 */
export async function addVaultQuickNote(
  userId: string,
  text: string,
): Promise<
  | { ok: true; noteId: string; path: string; title: string; blobSha: string; undo: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const supabase = await createVaultClient();
  const result = await addQuickNote(
    { ...quickNotePorts({ supabase, afterSave: () => {} }), timeZone: await zoneOf(userId) },
    text,
  );
  if (!result.ok) {
    if (result.reason === 'read-only' || result.reason === 'reconnect') ACCESS.delete(userId);
    return { ok: false, error: result.error };
  }
  // Quick notes still kept as files from before go in with it.
  after(() => foldQuickNoteFilesNow(supabase, userId));
  return {
    ok: true,
    noteId: result.noteId,
    path: result.path,
    title: result.title,
    blobSha: result.blobSha,
    undo: vaultUndoRecord(result.blobSha, { kind: 'section', id: result.section.id, text: result.section.text }) as unknown as Record<
      string,
      unknown
    >,
  };
}

/**
 * Fold the quick notes still kept as files in the Inbox into Quick note
 * triage (plan #3063), on the person's session. Run after a quick note is
 * added and when the Vault page finds such files, so the old files go the
 * first time either happens; with none left it reads the Inbox and stops.
 * Never throws: it runs after the person's own action.
 */
export async function foldQuickNoteFilesNow(supabase: VaultSupabaseClient, userId: string): Promise<FoldResult | null> {
  try {
    const inbox = await loadInboxNotes(supabase);
    const files = inbox.filter((note) => isQuickNoteFile(note.path, note.body));
    if (files.length === 0) return { folded: 0, removed: 0, failed: 0 };
    return await foldQuickNoteFiles(
      {
        ...quickNotePorts({ supabase, afterSave: () => {} }),
        remove: noteRemovePorts(supabase),
        timeZone: await zoneOf(userId),
      },
      files.map((note) => ({ id: note.id, path: note.path, body: note.body, blobSha: note.blobSha, writtenAt: note.writtenAt })),
    );
  } catch (error) {
    console.error('[vault quick notes] folding the old files', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Undo a note Dash wrote or changed, from its record: commit the file's
 * removal and mark the stored note deleted, or for an agent's edit, rename or
 * filing (plan #1894.9.3) commit what the note was back
 * (lib/vault/notes/undo.ts), then mark the record undone.
 */
export async function undoVaultCapture(
  deps: DashActionDeps,
  action: Pick<DashAction, 'id' | 'status' | 'subjectRef' | 'undo'>,
): Promise<{ ok: true; undoneAt: string } | { ok: false; error: string }> {
  if (action.status !== 'done') return { ok: false, error: 'This change has already been undone.' };
  const parsed = action.subjectRef ? parseRef(action.subjectRef) : null;
  const blobSha = action.undo?.vault_blob_sha;
  const undo = readVaultUndo(action.undo);
  if (!parsed || parsed.schema !== 'obsidian' || parsed.name !== 'notes' || typeof blobSha !== 'string' || !undo) {
    return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  }
  const vault = await createVaultClient();
  const removed = await undoVaultWrite(
    {
      remove: noteRemovePorts(vault),
      save: noteSavePorts({ supabase: vault, afterSave: () => {} }),
      rename: noteRenamePorts(vault),
      create: noteCreatePorts({ supabase: vault, afterSave: () => {} }),
    },
    parsed.id,
    blobSha,
    undo,
  );
  if (!removed.ok) return removed;
  await markDashActionUndone(deps, action.id);
  // A quick note's record names Quick note triage, whose files stay hers.
  if (undo.kind !== 'section') await forgetFiles(deps, action.subjectRef!);
  return { ok: true, undoneAt: deps.now ? deps.now() : new Date().toISOString() };
}
