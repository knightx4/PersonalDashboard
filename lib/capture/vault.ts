import 'server-only';

import { after } from 'next/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { forgetFiles, markDashActionUndone, type DashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import { parseRef } from '@/lib/core/refs';
import { createVaultClient } from '@/lib/vault/auth/server';
import { noteCreatePorts, noteRemovePorts, openConnectedSource } from '@/lib/vault/db/ports';
import { createCapturedNote, removeCapturedNote } from '@/lib/vault/notes/create';
import { embedVaultNotes } from '@/lib/vault/notes/embed';
import { checkWriteAccess, type WriteAccess } from '@/lib/vault/notes/write-access';

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

/** Write a note into the vault's Inbox, as the signed-in person. */
export async function fileVaultNote(
  userId: string,
  text: string,
  title?: string,
): Promise<{ ok: true; noteId: string; path: string; title: string; blobSha: string } | { ok: false; error: string }> {
  const supabase = await createVaultClient();
  const ports = noteCreatePorts({
    supabase,
    afterSave: () => {
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
    },
  });
  const result = await createCapturedNote(ports, text, title);
  if (!result.ok) {
    // The token stopped writing since it was checked: stop offering the vault.
    if (result.reason === 'read-only' || result.reason === 'reconnect') ACCESS.delete(userId);
    return { ok: false, error: result.error };
  }
  return { ok: true, noteId: result.noteId, path: result.path, title: result.title, blobSha: result.blobSha };
}

/**
 * Undo a note capture wrote, from its record: commit the file's removal,
 * mark the stored note deleted, then mark the record undone.
 */
export async function undoVaultCapture(
  deps: DashActionDeps,
  action: Pick<DashAction, 'id' | 'status' | 'subjectRef' | 'undo'>,
): Promise<{ ok: true; undoneAt: string } | { ok: false; error: string }> {
  if (action.status !== 'done') return { ok: false, error: 'This change has already been undone.' };
  const parsed = action.subjectRef ? parseRef(action.subjectRef) : null;
  const blobSha = action.undo?.vault_blob_sha;
  if (!parsed || parsed.schema !== 'obsidian' || parsed.name !== 'notes' || typeof blobSha !== 'string') {
    return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  }
  const removed = await removeCapturedNote(noteRemovePorts(await createVaultClient()), parsed.id, blobSha);
  if (!removed.ok) return removed;
  await markDashActionUndone(deps, action.id);
  await forgetFiles(deps, action.subjectRef!);
  return { ok: true, undoneAt: deps.now ? deps.now() : new Date().toISOString() };
}
