'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { detachNote, searchVaultNotes, type VaultNoteMatch } from '@/lib/learn/essays/vault-notes';

const Id = z.string().uuid();

/** Take an attached vault note off the essay (attached-notes.tsx). The note stays in the vault. */
// latency: pending
export async function detachVaultNote(essayId: string, attachmentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (!Id.safeParse(essayId).success || !Id.safeParse(attachmentId).success) {
    return { ok: false, error: 'Could not find that note on the essay.' };
  }
  try {
    await detachNote(await createLearnClient(), essayId, attachmentId);
    revalidatePath(`/learn/e/${essayId}`);
    return { ok: true };
  } catch (error) {
    console.error('[essay attached notes]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not take the note off. Try again in a moment.' };
  }
}

export type VaultNoteSearch = { ok: true; notes: VaultNoteMatch[] } | { ok: false; error: string };

/** Vault notes whose title holds `query`, for the merge dialog (merge-note-dialog.tsx). Up to ten, newest first. */
// latency: pending
export async function searchEssayVaultNotes(essayId: string, query: string): Promise<VaultNoteSearch> {
  await requireUser();
  if (!Id.safeParse(essayId).success) return { ok: false, error: 'That essay is not there any more.' };
  const needle = query.trim().slice(0, 200);
  if (!needle) return { ok: true, notes: [] };
  try {
    const [learn, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
    return { ok: true, notes: await searchVaultNotes(learn, vault, essayId, needle) };
  } catch (error) {
    console.error('[essay vault search]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not search your vault. Try again in a moment.' };
  }
}
