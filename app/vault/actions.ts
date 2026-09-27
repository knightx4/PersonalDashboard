'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';

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
