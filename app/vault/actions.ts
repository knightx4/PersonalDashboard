'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { fileVaultNote } from '@/lib/capture/vault';
import { createVaultClient } from '@/lib/vault/auth/server';
import { noteHref } from '@/lib/vault/paths';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { zoneDay } from '@/lib/core/when';
import { createCapturedNote } from '@/lib/vault/notes/create';
import { findDailyNote } from '@/lib/vault/notes/daily';
import { noteCreatePorts } from '@/lib/vault/db/ports';

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

/**
 * A quick note added from the Vault page (plan #1730, feature #1726): one
 * piece of text, filed in the Inbox folder through the capture box's write
 * (fileVaultNote) and left there to be sorted in Quick note triage. Unlike
 * newVaultNote it opens nothing; the list stays where it is and the waiting
 * count goes up.
 */
// latency: pending
export async function addQuickNote(text: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Write the note first.' };
  const result = await fileVaultNote(user.id, trimmed);
  if (!result.ok) return { error: result.error };
  revalidatePath('/vault');
  revalidatePath('/vault/triage');
  return { error: null };
}

export type DailyNoteState = { error: string | null };

/**
 * Today's daily note, opened from the vault page (note a268529a): the note
 * named for today's date in the person's zone, wherever it is filed, or a
 * new empty one written at the top of the vault when there is none.
 */
// latency: pending
export async function openDailyNote(): Promise<DailyNoteState> {
  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);
  const day = zoneDay(new Date(), timezone);
  const supabase = await createVaultClient();
  const { data, error } = await supabase
    .from('notes')
    .select('path')
    .is('deleted_at', null)
    .like('path', `%${day}.md`);
  if (error) return { error: 'Your notes could not be read. Try again.' };
  const found = findDailyNote((data ?? []).map((row) => row.path as string), day);
  if (found) redirect(noteHref(found));

  // One name only: a numbered "2026-10-20 2.md" would not be the daily note.
  const result = await createCapturedNote(noteCreatePorts({ supabase, afterSave: () => {} }), '', day, '', 1);
  if (!result.ok) return { error: result.error };
  revalidatePath('/vault');
  redirect(noteHref(result.path));
}
