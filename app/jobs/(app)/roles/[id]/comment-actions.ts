'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requestDashDeps } from '@/lib/ask/clients';
import { threadDashInRequest } from '@/lib/talk/ask-request';
import { mentionsDash, questionFrom } from '@/lib/comments/mention';
import { COMMENT_MAX } from '@/lib/goals/comments';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { askDashOnRole } from '@/lib/jobs/role-thread/ask';
import { toRef } from '@/lib/core/refs';
import { ROLE_THREAD_TABLE } from '@/lib/dash/thread-tools';
import { addThreadTurn, removeThreadTurn } from '@/lib/thread/store';

/**
 * Writing and removing a comment on a role (note 89ad8bef). The thread is kept
 * in core.conversations under the role's ref, `job_search.roles:<id>`, since
 * plan #1470 (lib/thread/store.ts); it used to be the role's notes in
 * job_search.notes, which no longer take it. The same form the other threads post
 * (components/thread/thread.tsx): `id` is the role, `body` the words. A
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
  let writtenId: string;
  try {
    writtenId = await addThreadTurn(supabase, {
      userId: user.id,
      ref: toRef(ROLE_THREAD_TABLE, id.data),
      author: 'me',
      body: body.data,
    });
  } catch {
    return { error: 'The comment could not be saved. Try again.' };
  }

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
    commentId: writtenId,
    question: questionFrom(body.data),
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    dash: await requestDashDeps(user.id),
    dashThread: await threadDashInRequest(user.id),
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

  let ref: string | null;
  try {
    ref = await removeThreadTurn(await createClient(), { id: id.data, userId: user.id });
  } catch {
    return { error: 'The comment could not be deleted. Try again.' };
  }
  if (!ref) return { error: 'That comment is already gone.' };
  const roleId = ref.slice(ref.indexOf(':') + 1);

  revalidatePath(`/jobs/roles/${roleId}`);
  return { message: 'Deleted.' };
}
