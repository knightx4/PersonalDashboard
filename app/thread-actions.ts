'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requestDashDeps } from '@/lib/ask/clients';
import { requireUser } from '@/lib/auth/server';
import { mentionsDash, questionFrom } from '@/lib/comments/mention';
import { createCoreClient } from '@/lib/core/auth/server';
import { OPEN_PATH, parseRef, refHref } from '@/lib/core/refs';
import { COMMENT_MAX } from '@/lib/goals/comments';
import { threadDashInRequest } from '@/lib/talk/ask-request';
import { askDashOnRow } from '@/lib/thread/ask';
import { addThreadTurn, removeThreadTurn, THREAD_ROW_NOT_YOURS } from '@/lib/thread/store';

/**
 * Writing and removing a comment under any row whose thread has no actions of
 * its own (plan #1441): a file today, and any thread added after it. The form
 * is the one every thread posts (components/thread/thread.tsx): `subject` is
 * the row's ref, `body` the words. The database refuses a ref that is not the
 * account's (core.ref_owned), so nothing here lists which tables may hold a
 * thread. A comment tagged @dash gets its reply in the thread before this
 * returns (lib/thread/ask.ts).
 */

export type RowCommentState = { error?: string; message?: string };

const Id = z.string().uuid();
const Body = z.string().trim().min(1, 'Write something.').max(COMMENT_MAX);

/** Redraw the page the row opens on, or every page when that cannot be told from the ref. */
function redraw(ref: string): void {
  const href = refHref(ref);
  if (href && !href.startsWith(OPEN_PATH)) revalidatePath(href);
  else revalidatePath('/', 'layout');
}

// latency: pending
export async function addRowComment(_prev: RowCommentState, form: FormData): Promise<RowCommentState> {
  const user = await requireUser();
  const subject = form.get('subject');
  const parsed = typeof subject === 'string' ? parseRef(subject) : null;
  const body = Body.safeParse(form.get('body') ?? '');
  if (!parsed) return { error: 'Could not tell which row the comment is on.' };
  if (!body.success) return { error: body.error.issues[0].message };
  const ref = `${parsed.table}:${parsed.id}`;

  const core = await createCoreClient();
  let writtenId: string;
  try {
    writtenId = await addThreadTurn(core, { userId: user.id, ref, author: 'me', body: body.data });
  } catch (error) {
    if (error instanceof Error && error.message === THREAD_ROW_NOT_YOURS) return { error: 'That is no longer here.' };
    return { error: 'The comment could not be saved. Try again.' };
  }

  // Untagged, it is a note on the row, read by whatever reads the row.
  if (!mentionsDash(body.data)) {
    redraw(ref);
    return { message: 'Saved.' };
  }

  const asked = await askDashOnRow({
    client: core,
    userId: user.id,
    ref,
    commentId: writtenId,
    question: questionFrom(body.data),
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    dash: await requestDashDeps(user.id),
    dashThread: await threadDashInRequest(user.id),
  });

  // One redraw after the reply, so the question and its answer arrive together.
  redraw(ref);
  return { message: asked.ok ? asked.message : asked.error };
}

// latency: pending
export async function deleteRowComment(_prev: RowCommentState, form: FormData): Promise<RowCommentState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which comment that was.' };

  let ref: string | null;
  try {
    ref = await removeThreadTurn(await createCoreClient(), { id: id.data, userId: user.id });
  } catch {
    return { error: 'The comment could not be deleted. Try again.' };
  }
  if (!ref) return { error: 'That comment is already gone.' };
  redraw(ref);
  return { message: 'Deleted.' };
}
