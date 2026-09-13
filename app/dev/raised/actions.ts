'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';

export type RaisedActionState = {
  error?: string;
  message?: string;
};

const idSchema = z.string().uuid();
const bodySchema = z.string().trim().min(1, 'Write something.').max(4000);

/**
 * Answering one, which is what the page is for.
 *
 * The answer is a row in the thread rather than a column on the raise, so a
 * session can reply to it and you can come back — decision #202. Answering
 * also closes the raise: it is out of the open list from here, and a session
 * that wants another round writes a comment rather than reopening it.
 *
 * `answered_at` is the first answer, not the last: it says when you got to it.
 */
// latency: pending
export async function answerRaise(
  _prev: RaisedActionState,
  formData: FormData,
): Promise<RaisedActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = idSchema.safeParse(formData.get('id'));
  const body = bodySchema.safeParse(formData.get('body') ?? '');
  if (!id.success) return { error: 'Missing raise.' };
  if (!body.success) return { error: body.error.issues[0].message };

  const { data: raise } = await supabase
    .from('raised_items')
    .select('id, answered_at')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!raise) return { error: 'That raise no longer exists.' };

  const { error: commentError } = await supabase.from('dev_comments').insert({
    user_id: user.id,
    raised_item_id: id.data,
    author: 'me',
    body: body.data,
  });
  if (commentError) return { error: commentError.message };

  const { error } = await supabase
    .from('raised_items')
    .update({
      status: 'answered',
      answered_at: (raise.answered_at as string | null) ?? new Date().toISOString(),
    })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/raised');
  return { message: 'Answered.' };
}

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
