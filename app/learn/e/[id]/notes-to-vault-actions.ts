'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { essayTitle } from '@/lib/learn/essays/model';
import { essayDay } from '@/lib/learn/essays/note';
import { notesOf } from '@/lib/learn/essays/notebook';
import {
  addNotesToVault,
  NOTES_TO_VAULT_ERRORS,
  previewNotesToVault,
  type NotesToVaultFailure,
  type NotesToVaultInput,
} from '@/lib/learn/essays/notes-to-vault';
import { readPlan } from '@/lib/learn/essays/plan';
import { loadEssay } from '@/lib/learn/essays/store';
import { vaultNoteHref } from '@/lib/learn/essays/vault-notes';
import { createVaultClient } from '@/lib/vault/auth/server';
import { noteSavePorts } from '@/lib/vault/db/ports';
import { embedVaultNotes } from '@/lib/vault/notes/embed';

/**
 * Adding an essay's notes to the end of a vault note (plan #2357.4): a
 * preview first, then the add, which commits the note to the vault through
 * the note editor's save. The decisions are in lib/learn/essays/notes-to-vault.ts.
 */

const Id = z.string().uuid();
const TimeZone = z.string().max(64).nullable();
const BlobSha = z.string().trim().min(1).max(200);

/** How long the embedding after a save may run, as after a note edit. */
const EMBED_AFTER_SAVE_MS = 20_000;

type Failed = { ok: false; reason: NotesToVaultFailure; error: string };

export type NotesToVaultPreviewResult =
  | {
      ok: true;
      noteId: string;
      path: string;
      title: string;
      /** Pass back to addEssayNotesToVaultNote, which refuses any other version. */
      blobSha: string;
      /** The note's text now, without frontmatter. */
      before: string;
      /** The note's text once the notes are added. */
      after: string;
      /** The notes are already the note's last block; adding changes nothing. */
      unchanged: boolean;
    }
  | Failed;

export type NotesToVaultAddResult =
  | { ok: true; path: string; blobSha: string; commitSha: string | null }
  | Failed;

function failed(reason: NotesToVaultFailure, detail?: string): Failed {
  if (reason === 'error' && detail) console.error('[essay notes to vault]', detail);
  return { ok: false, reason, error: NOTES_TO_VAULT_ERRORS[reason] };
}

/** The essay's notes and title, and the vault note's path, read on the person's own clients. */
async function gather(
  essayId: string,
  noteId: string,
  timeZone: string | null,
): Promise<{ vault: Awaited<ReturnType<typeof createVaultClient>>; input: NotesToVaultInput } | Failed> {
  const [learn, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const essay = await loadEssay(learn, essayId);
  if (!essay) return { ok: false, reason: 'error', error: 'That essay is not there any more.' };
  const { data, error } = await vault
    .from('notes')
    .select('path')
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return failed('error', `Reading note ${noteId} failed: ${error.message}`);
  if (!data) return failed('not-found');
  return {
    vault,
    input: {
      path: (data as { path: string }).path,
      notes: notesOf(essay.brief, essay.plan ?? readPlan(null)),
      title: essayTitle(essay.draftBody, essay.path),
      date: essayDay(new Date(), timeZone),
    },
  };
}

function parse(essayId: string, noteId: string, timeZone: string | null): boolean {
  return (
    Id.safeParse(essayId).success && Id.safeParse(noteId).success && TimeZone.safeParse(timeZone).success
  );
}

/**
 * The vault note as it would read with the essay's saved notes added at the
 * end, for the merge dialog to show before anything is saved. Writes nothing.
 * `timeZone` dates the heading, as the essay's vault save does.
 */
// latency: pending
export async function previewEssayNotesInVaultNote(
  essayId: string,
  noteId: string,
  timeZone: string | null,
): Promise<NotesToVaultPreviewResult> {
  await requireUser();
  if (!parse(essayId, noteId, timeZone)) return failed('not-found');
  try {
    const got = await gather(essayId, noteId, timeZone);
    if ('ok' in got) return got;
    const preview = await previewNotesToVault(
      noteSavePorts({ supabase: got.vault, afterSave: () => {} }).loadNote,
      got.input,
    );
    if (!preview.ok) return failed(preview.reason, preview.detail);
    return { ...preview, noteId };
  } catch (error) {
    return failed('error', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Add the essay's saved notes to the end of the vault note, under a dated
 * heading with the essay's title, as one commit. `blobSha` is the one the
 * preview returned: a note changed since, in the app or in Obsidian, is
 * refused with reason 'changed' and left as it was.
 */
// latency: pending
export async function addEssayNotesToVaultNote(
  essayId: string,
  noteId: string,
  blobSha: string,
  timeZone: string | null,
): Promise<NotesToVaultAddResult> {
  const user = await requireUser();
  if (!parse(essayId, noteId, timeZone) || !BlobSha.safeParse(blobSha).success) return failed('not-found');
  try {
    const got = await gather(essayId, noteId, timeZone);
    if ('ok' in got) return got;
    const vault = got.vault;
    const ports = noteSavePorts({
      supabase: vault,
      afterSave: () => {
        after(async () => {
          try {
            await embedVaultNotes(vault, await createCoreClient(), {
              userId: user.id,
              deadline: Date.now() + EMBED_AFTER_SAVE_MS,
            });
          } catch (error) {
            console.error('[essay notes to vault] note embedding', error instanceof Error ? error.message : error);
          }
        });
      },
    });
    const result = await addNotesToVault(ports, { ...got.input, expectedBlobSha: blobSha });
    if (!result.ok) return failed(result.reason, result.detail);
    revalidatePath('/vault');
    revalidatePath(vaultNoteHref(result.path));
    revalidatePath(`/learn/e/${essayId}`);
    return result;
  } catch (error) {
    return failed('error', error instanceof Error ? error.message : String(error));
  }
}
