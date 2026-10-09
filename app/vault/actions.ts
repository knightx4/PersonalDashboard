'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { fileVaultNote } from '@/lib/capture/vault';
import { createVaultClient } from '@/lib/vault/auth/server';
import { noteHref } from '@/lib/vault/paths';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hide one of this week's connections on the vault page (plan #1115). Sets
 * dismissed_at through the session client, the one column RLS and the grants
 * let the owner change.
 */
// latency: optimistic
export async function dismissNoteConnection(id: string): Promise<{ error: string | null }> {
  if (!UUID.test(id)) return { error: 'Could not tell which connection that was.' };
  await requireUser();
  const supabase = await createVaultClient();
  const { error } = await supabase
    .from('note_connections')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .is('dismissed_at', null);
  if (error) return { error: 'That did not save. Try again.' };
  revalidatePath('/vault');
  return { error: null };
}

export type NewNoteState = { error: string | null };

/**
 * A new note written on the vault page (note 09ff8039): committed to the
 * vault's Inbox, named by its title, and opened. The same write capture
 * files a note with (lib/capture/vault.ts), so it reaches Obsidian on its
 * next pull.
 */
// latency: pending
export async function newVaultNote(_prev: NewNoteState, formData: FormData): Promise<NewNoteState> {
  const user = await requireUser();
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title && !body) return { error: 'Write a title or a line first.' };
  const result = await fileVaultNote(user.id, body || title, title || undefined);
  if (!result.ok) return { error: result.error };
  revalidatePath('/vault');
  redirect(noteHref(result.path));
}
