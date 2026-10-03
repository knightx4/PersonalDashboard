'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { requestDashDeps } from '@/lib/ask/clients';
import { threadDashInRequest } from '@/lib/talk/ask-request';
import { askDash } from '@/lib/comments/ask';
import { COMMENT_TARGETS, CONVERSATIONS_PATH, TARGET_PATH, type CommentTarget } from '@/lib/comments/load';
import { addThreadTurn, removeThreadTurn } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
import { mentionsDash, questionFrom } from '@/lib/comments/mention';
import { pickUpRaise } from '@/lib/raised/pickup';

/**
 * Writing and removing a comment, from any of the three dev pages.
 *
 * One file rather than a copy in each page's own actions, because the write is
 * the same write: the target decides which column the row names and which page
 * is revalidated, and nothing else differs. What you write is always 'me'; the
 * replies under it are 'claude', which is what tells the two halves of a thread
 * apart.
 */

export type CommentActionState = {
  error?: string;
  message?: string;
};

/**
 * The row's own page, and the list of every conversation, which now shows the
 * same thread.
 */
function redraw(target: CommentTarget) {
  revalidatePath(TARGET_PATH[target]);
  if (TARGET_PATH[target] !== CONVERSATIONS_PATH) revalidatePath(CONVERSATIONS_PATH);
}

const idSchema = z.string().uuid();
const targetSchema = z.enum(COMMENT_TARGETS);
const bodySchema = z.string().trim().min(1, 'Write something.').max(4000);

/**
 * A comment on an idea, a plan step or a raise, and the reply when it asks for
 * one.
 *
 * Tagging `@dash` is what turns a note into a question — see
 * lib/comments/mention.ts for why the test for the tag is strict. Everything
 * that follows from it is in lib/comments/ask.ts, so the two paths a reply can
 * take are described in one place rather than half here.
 *
 * A raise is the exception, and lib/raised/pickup.ts is why: it is a question
 * put to you, so a comment on one is an answer whether or not it carries the
 * tag, and an answer starts a session that acts on it.
 *
 * Ownership of the row being commented on is checked by the database rather
 * than here: core.refs_check refuses a thread under somebody else's row
 * (migrations 0165 and 0167), which is the check that holds whoever is
 * calling.
 */
// latency: pending
export async function addComment(
  _prev: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const target = targetSchema.safeParse(String(formData.get('target') ?? ''));
  const id = idSchema.safeParse(formData.get('id'));
  const body = bodySchema.safeParse(formData.get('body') ?? '');
  if (!target.success) return { error: 'Missing what the comment is about.' };
  if (!id.success) return { error: 'Missing what the comment is about.' };
  if (!body.success) return { error: body.error.issues[0].message };

  // Into the shared store, under the row's ref (plan #1470).
  let writtenId: string;
  try {
    writtenId = await addThreadTurn(supabase, {
      userId: user.id,
      ref: threadRef(target.data, id.data),
      author: 'me',
      body: body.data,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The comment could not be saved.' };
  }

  // Untagged, so it is a note to yourself and this is the end of it -- except
  // on a raise, where there is nobody else it could be addressed to. The raise
  // asked you something, so what you write on it is the answer, and #541 is
  // that the answer starts the run rather than waiting for a tag nobody thinks
  // to add. It is what left two raises carrying an answer for five and six
  // days.
  if (!mentionsDash(body.data)) {
    if (target.data === 'raise') {
      const picked = await pickUpRaise({
        supabase,
        userId: user.id,
        id: id.data,
        commentId: writtenId,
        answer: body.data,
      });
      redraw(target.data);
      if (picked.ok) return { message: picked.message };
      return picked.said ? { error: picked.said } : { message: 'Saved.' };
    }

    redraw(target.data);
    return { message: 'Saved.' };
  }

  const asked = await askDash({
    supabase,
    userId: user.id,
    target: target.data,
    id: id.data,
    commentId: writtenId,
    question: questionFrom(body.data),
    dash: await requestDashDeps(user.id),
    dashThread: await threadDashInRequest(user.id),
  });

  // One redraw, after the reply, so the question and the answer under it
  // arrive together. What comes back is a message rather than an error either
  // way: the comment is written, and when no reply could be produced the thread
  // says why.
  redraw(target.data);
  // And the page an action wrote to, when that was somewhere else.
  if (asked.ok && asked.redraw) revalidatePath(asked.redraw);
  return { message: asked.ok ? asked.message : asked.error };
}

/** Taking one back out. Yours and a session's alike: it is your thread. */
// latency: pending
export async function deleteComment(
  _prev: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const target = targetSchema.safeParse(String(formData.get('target') ?? ''));
  const id = idSchema.safeParse(formData.get('id'));
  if (!target.success) return { error: 'Missing which page to redraw.' };
  if (!id.success) return { error: 'Missing comment.' };

  try {
    await removeThreadTurn(supabase, { id: id.data, userId: user.id });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The comment could not be deleted.' };
  }

  redraw(target.data);
  return { message: 'Deleted.' };
}
