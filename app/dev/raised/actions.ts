'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';

export type RaisedActionState = {
  error?: string;
  message?: string;
};

const idSchema = z.string().uuid();

/**
 * Closing a raise without saying anything.
 *
 * The answer to some of these is that they did not need asking, and a page
 * where the only way to clear a row is to write a paragraph is a page that
 * fills up. `answered_at` stays null, because nothing was answered.
 */
// latency: pending
export async function dismissRaise(
  _prev: RaisedActionState,
  formData: FormData,
): Promise<RaisedActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing raise.' };

  const { error } = await supabase
    .from('raised_items')
    .update({ status: 'dismissed' })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/raised');
  return { message: 'Dismissed.' };
}

/** Putting one back in the open list, for a dismissal you want back. */
// latency: pending
export async function reopenRaise(
  _prev: RaisedActionState,
  formData: FormData,
): Promise<RaisedActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing raise.' };

  const { error } = await supabase
    .from('raised_items')
    .update({ status: 'open', answered_at: null })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/raised');
  return { message: 'Reopened.' };
}
