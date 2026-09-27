'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { mentionsDash, questionFrom } from '@/lib/comments/mention';
import { COMMENT_MAX } from '@/lib/goals/comments';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { askDashOnRole } from '@/lib/jobs/role-thread/ask';

/**
 * Writing and removing a comment on a role (note 89ad8bef). The thread is the
 * role's notes in job_search.notes, oldest first, with `author` telling your
 * comments from Dash's (migration 0033). The same form the other threads post
 * (components/dev/comment-thread.tsx): `id` is the role, `body` the words. A
 * comment tagged @dash gets its reply in the thread before this returns.
 */

export type RoleCommentState = { error?: string; message?: string };

const Id = z.string().uuid();
const Body = z.string().trim().min(1, 'Write something.').max(COMMENT_MAX);

// latency: pending
export async function addRoleComment(
  _prev: RoleCommentState,
  form: FormData,
): Promise<RoleCommentState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  const body = Body.safeParse(form.get('body') ?? '');
  if (!id.success) return { error: 'Could not tell which role the comment is on.' };
  if (!body.success) return { error: body.error.issues[0].message };

  const supabase = await createClient();
  const { data: written, error } = await supabase
    .from('notes')
    .insert({ user_id: user.id, role_id: id.data, author: 'me', body: body.data })
    .select('id')
    .single();
  if (error || !written) return { error: 'The comment could not be saved. Try again.' };

  const path = `/jobs/roles/${id.data}`;
  // Untagged, it is a note on the role and nothing reads it.
  if (!mentionsDash(body.data)) {
    revalidatePath(path);
    return { message: 'Saved.' };
  }

  const asked = await askDashOnRole({
    client: supabase,
    userId: user.id,
    roleId: id.data,
    commentId: written.id as string,
    question: questionFrom(body.data),
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
  });

  // One redraw after the reply, so the question, its answer and any letter
  // arrive together.
  revalidatePath(path);
  return { message: asked.ok ? asked.message : asked.error };
}

// latency: pending
export async function deleteRoleComment(
  _prev: RoleCommentState,
  form: FormData,
): Promise<RoleCommentState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which comment that was.' };

  const supabase = await createClient();
  const { data: gone, error } = await supabase
    .from('notes')
    .delete()
    .eq('id', id.data)
    .eq('user_id', user.id)
    .select('role_id');
  if (error) return { error: 'The comment could not be deleted. Try again.' };
  const roleId = gone?.[0]?.role_id as string | undefined;
  if (!roleId) return { error: 'That comment is already gone.' };

  revalidatePath(`/jobs/roles/${roleId}`);
  return { message: 'Deleted.' };
}
