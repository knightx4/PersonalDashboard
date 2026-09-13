'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { carryOut } from '@/lib/comments/act';
import { isModuleId } from '@/lib/modules';
import { consequenceFrom } from '@/lib/raised/consequence';

export type RaisedActionState = {
  error?: string;
  message?: string;
};

const idSchema = z.string().uuid();
const bodySchema = z.string().trim().min(1, 'Write something.').max(4000);
const answerSchema = z.enum(['yes', 'no']);

/**
 * One line in the thread, under the same account and marked as whose it is.
 *
 * Both halves are written by you: the marker is the only thing that says which
 * of them said it, the same as lib/comments/ask.ts.
 */
async function say(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  id: string,
  author: 'me' | 'claude',
  body: string,
): Promise<void> {
  await supabase.from('dev_comments').insert({
    user_id: userId,
    raised_item_id: id,
    author,
    body,
  });
}

/**
 * Yes or no on a raise that named what a yes does.
 *
 * A yes runs that action -- no model call and no session, because it was named
 * when the raise was filed -- through the same lib/comments/act.ts a comment
 * instruction goes through, so neither can approve a proposal, answer a
 * question, dismiss a row or set a status by hand. What it did goes in the
 * thread in the same words.
 *
 * A yes whose action fails leaves the raise open: the thread says why, and a
 * raise closed over something that did not happen is the thing this exists to
 * stop.
 *
 * A no closes it with the reason and does nothing else.
 */
// latency: pending
export async function decideRaise(
  _prev: RaisedActionState,
  formData: FormData,
): Promise<RaisedActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = idSchema.safeParse(formData.get('id'));
  const answer = answerSchema.safeParse(formData.get('answer'));
  if (!id.success) return { error: 'Missing raise.' };
  if (!answer.success) return { error: 'Say yes or no.' };

  const { data: raise } = await supabase
    .from('raised_items')
    .select('id, module, consequence, answered_at')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!raise) return { error: 'That raise no longer exists.' };

  const answeredAt = (raise.answered_at as string | null) ?? new Date().toISOString();
  const close = () =>
    supabase
      .from('raised_items')
      .update({ status: 'answered', answered_at: answeredAt })
      .eq('id', id.data)
      .eq('user_id', user.id);

  if (answer.data === 'no') {
    const reason = bodySchema.safeParse(formData.get('body') ?? '');
    if (!reason.success) return { error: 'Say why not. It is what the raise closes on.' };

    await say(supabase, user.id, id.data, 'me', `No — ${reason.data}`);
    const { error } = await close();
    if (error) return { error: error.message };

    revalidatePath('/dev/raised');
    return { message: 'Closed.' };
  }

  const scope = raise.module as string | null;
  const consequence = consequenceFrom(
    raise.consequence,
    scope && isModuleId(scope) ? scope : null,
  );
  if (!consequence) {
    return { error: 'This raise never said what a yes would do, so there is nothing to run.' };
  }

  await say(supabase, user.id, id.data, 'me', 'Yes.');
  const outcome = await carryOut({
    supabase,
    userId: user.id,
    target: 'raise',
    id: id.data,
    action: consequence.action,
  });
  await say(supabase, user.id, id.data, 'claude', outcome.ok ? outcome.said : outcome.why);

  if (!outcome.ok) {
    revalidatePath('/dev/raised');
    return { error: outcome.why };
  }

  const { error } = await close();
  if (error) return { error: error.message };

  if (outcome.redraw) revalidatePath(outcome.redraw);
  revalidatePath('/dev/raised');
  return { message: 'Done.' };
}

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
