'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { COMMENT_TARGETS, TARGET_COLUMN, TARGET_PATH } from '@/lib/comments/load';

/**
 * Writing and removing a comment, from any of the three dev pages.
 *
 * One file rather than a copy in each page's own actions, because the write is
 * the same write: the target decides which column the row names and which page
 * is revalidated, and nothing else differs. The author is always 'me' — a
 * session writes its own replies, and the column exists so the two halves of a
 * thread can be told apart.
 */

export type CommentActionState = {
  error?: string;
  message?: string;
};

const idSchema = z.string().uuid();
const targetSchema = z.enum(COMMENT_TARGETS);
const bodySchema = z.string().trim().min(1, 'Write something.').max(4000);

/**
 * A comment on an idea, a plan step or a raise.
 *
 * Ownership of the row being commented on is checked by the insert policy in
 * migration 0062 rather than here: a comment on somebody else's row matches no
 * policy and is refused, which is the check that holds whoever is calling.
 */
// latency: pending
export async function addComment(
  _prev: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const target = targetSchema.safeParse(String(formData.get('target') ?? ''));
  const id = idSchema.safeParse(formData.get('id'));
  const body = bodySchema.safeParse(formData.get('body') ?? '');
  if (!target.success) return { error: 'Missing what the comment is about.' };
  if (!id.success) return { error: 'Missing what the comment is about.' };
  if (!body.success) return { error: body.error.issues[0].message };

  const { error } = await supabase.from('dev_comments').insert({
    user_id: user.id,
    [TARGET_COLUMN[target.data]]: id.data,
    author: 'me',
    body: body.data,
  });
  if (error) return { error: error.message };

  revalidatePath(TARGET_PATH[target.data]);
  return { message: 'Saved.' };
}

/** Taking one back out. Yours and a session's alike: it is your thread. */
// latency: pending
export async function deleteComment(
  _prev: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const target = targetSchema.safeParse(String(formData.get('target') ?? ''));
  const id = idSchema.safeParse(formData.get('id'));
  if (!target.success) return { error: 'Missing which page to redraw.' };
  if (!id.success) return { error: 'Missing comment.' };

  const { error } = await supabase
    .from('dev_comments')
    .delete()
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath(TARGET_PATH[target.data]);
  return { message: 'Deleted.' };
}
