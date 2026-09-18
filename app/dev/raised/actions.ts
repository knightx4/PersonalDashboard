'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { carryOut } from '@/lib/comments/act';
import { askDash } from '@/lib/comments/ask';
import { isCommentTarget, type CommentTarget } from '@/lib/comments/load';
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
 * of them said it, the same as lib/comments/ask.ts. The id comes back because
 * a line of yours that is also an instruction is handed to the comment path,
 * which leaves it out of the history it reads.
 */
async function say(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  id: string,
  author: 'me' | 'claude',
  body: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('dev_comments')
    .insert({ user_id: userId, raised_item_id: id, author, body })
    .select('id')
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
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
 * Words written beside a yes are not covered by the action it declared, so
 * they go down the comment path afterwards and can file an idea, start a
 * build or reword a row like any other instruction. A yes on its own costs no
 * model call.
 *
 * A no closes it with the reason and does nothing else.
 */
// latency: pending
export async function decideRaise(
  _prev: RaisedActionState,
  formData: FormData,
): Promise<RaisedActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

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

  /**
   * Closing it, and what it produced.
   *
   * `outcome` is required here rather than optional: a raise that reaches
   * answered with nothing in that column is one that closed into nothing, and
   * /dev/raised lists it as still waiting on its own follow-through. #367 is
   * that rule, and this is the only place a raise is answered.
   */
  const close = (outcome: string) =>
    supabase
      .from('raised_items')
      .update({ status: 'answered', answered_at: answeredAt, outcome })
      .eq('id', id.data)
      .eq('user_id', user.id);

  if (answer.data === 'no') {
    const reason = bodySchema.safeParse(formData.get('body') ?? '');
    if (!reason.success) return { error: 'Say why not. It is what the raise closes on.' };

    await say(supabase, user.id, id.data, 'me', `No — ${reason.data}`);
    const { error } = await close(reason.data);
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

  const extra = String(formData.get('body') ?? '').trim().slice(0, 4000);
  const said = await say(supabase, user.id, id.data, 'me', extra ? `Yes — ${extra}` : 'Yes.');

  const outcome = await carryOut({
    supabase,
    userId: user.id,
    target: 'raise',
    id: id.data,
    action: consequence.action,
  });
  await say(supabase, user.id, id.data, 'claude', outcome.ok ? outcome.said : outcome.why);

  if (outcome.ok) {
    const { error } = await close(outcome.said);
    if (error) return { error: error.message };
    if (outcome.redraw) revalidatePath(outcome.redraw);
  }

  // What they wrote beyond the yes, handled as a comment on the same raise:
  // the declared action covers the option and nothing else, and "take a look
  // at the bug I just sent in too" is an instruction like any other.
  const asked = extra && said
    ? await askDash({
        supabase,
        userId: user.id,
        target: 'raise',
        id: id.data,
        commentId: said,
        question: extra,
      })
    : null;
  if (asked?.ok && asked.redraw) revalidatePath(asked.redraw);

  revalidatePath('/dev/raised');
  if (!outcome.ok) return { error: outcome.why };
  if (asked && !asked.ok) return { error: asked.error };
  return { message: asked ? `Done. ${asked.message}` : 'Done.' };
}

/**
 * Filing one you are finished with.
 *
 * Answering a raise is you replying, which is not the same as being done with
 * it: a yes that files an idea leaves the work behind it, and the reply a
 * session owes on an answer is often written days later. So an answered raise
 * stayed answered and read that way for as long as it existed, with nothing
 * past it but a dismissal, which says something else entirely.
 *
 * Only offered on a raise that is already answered and carries an outcome. The
 * rule #367 holds -- a raise closes on what it produced -- and closing is not a
 * second way of answering one, so an open raise is refused here rather than
 * given a quiet way out of being answered.
 */
// latency: pending
export async function closeRaise(
  _prev: RaisedActionState,
  formData: FormData,
): Promise<RaisedActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing raise.' };

  const { data: raise } = await supabase
    .from('raised_items')
    .select('status, outcome')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!raise) return { error: 'That raise no longer exists.' };
  if (raise.status !== 'answered') {
    return { error: 'Only an answered raise can be closed. Answer it or dismiss it.' };
  }
  if (!raise.outcome) {
    return { error: 'Nothing is recorded as coming of this one. Close it with a reason instead.' };
  }

  const { error } = await supabase
    .from('raised_items')
    .update({ status: 'closed' })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/raised');
  return { message: 'Closed.' };
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
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

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

/** Putting one back in the open list, for a row you closed or dismissed too soon. */
// latency: pending
export async function reopenRaise(
  _prev: RaisedActionState,
  formData: FormData,
): Promise<RaisedActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing raise.' };

  const { error } = await supabase
    .from('raised_items')
    .update({ status: 'open', answered_at: null, outcome: null })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/dev/raised');
  return { message: 'Reopened.' };
}

/**
 * Opening a conversation is what marks it read — #432.
 *
 * Called from the list rather than submitted, and it redraws nothing: a
 * revalidate here would fold the conversation shut again as you opened it. The
 * line drops its own mark, and the date is what the next load reads.
 *
 * Upserted rather than inserted, because opening the same conversation twice
 * is the ordinary case and the second one has to move the date forward.
 */
// latency: instant -- the line drops its own mark; the write is not waited on
export async function markConversationRead(
  target: CommentTarget,
  id: string,
): Promise<RaisedActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  if (!isCommentTarget(target)) return { error: 'Missing what was read.' };
  const row = idSchema.safeParse(id);
  if (!row.success) return { error: 'Missing what was read.' };

  const { error } = await supabase.from('dev_comment_reads').upsert(
    {
      user_id: user.id,
      target,
      row_id: row.data,
      read_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,target,row_id' },
  );
  if (error) return { error: error.message };

  return { message: 'Read.' };
}
