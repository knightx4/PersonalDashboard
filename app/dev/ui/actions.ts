'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { TASTE } from './taste';

/**
 * Taking a preference off /dev/ui, and putting it back (plan #1547).
 *
 * The preferences are written in ./taste.ts, which a press cannot edit, so a
 * removal is a row in `public.ui_taste_removals` (migration 0180). The page
 * leaves those out of the list, a session building a screen tells the critic
 * they no longer hold, and the notes routine does not add them again.
 * Putting one back deletes the row.
 */

export type TasteActionState = { error?: string };

const tasteId = z
  .string()
  .refine((id) => TASTE.some((taste) => taste.id === id), { message: 'No such preference.' });

// latency: pending
export async function removeTaste(
  _prev: TasteActionState,
  formData: FormData,
): Promise<TasteActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = tasteId.safeParse(formData.get('id'));
  if (!id.success) return { error: 'No such preference.' };

  const { error } = await supabase
    .from('ui_taste_removals')
    .upsert({ user_id: user.id, taste_id: id.data }, { onConflict: 'user_id,taste_id', ignoreDuplicates: true });
  if (error) return { error: 'That preference could not be removed just now. Try again.' };

  revalidatePath('/dev/ui');
  return {};
}

// latency: pending
export async function restoreTaste(
  _prev: TasteActionState,
  formData: FormData,
): Promise<TasteActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = tasteId.safeParse(formData.get('id'));
  if (!id.success) return { error: 'No such preference.' };

  const { error } = await supabase
    .from('ui_taste_removals')
    .delete()
    .eq('user_id', user.id)
    .eq('taste_id', id.data);
  if (error) return { error: 'That preference could not be put back just now. Try again.' };

  revalidatePath('/dev/ui');
  return {};
}
