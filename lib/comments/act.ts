/**
 * Doing what a comment asked for, rather than writing back about it.
 *
 * A comment tagged `@dash` used to have one outcome: a sentence in the thread.
 * Half of what gets written on these rows is not a question — "file that as
 * its own idea", "reword this one" — and an answer explaining that it could be
 * done is the least useful thing to say to somebody who has just said to do it.
 * #359 settled that it is carried out and reported afterwards, with what it
 * changed written into the thread so it can be put back by hand.
 *
 * Every write here goes through the caller's own client, so the row's policies
 * check the ownership: an action aimed at somebody else's row matches nothing
 * and fails, and nothing in this file has to remember to filter by user.
 *
 * What it may do is the list in `ACTIONS` and nothing else. The moves left out
 * are left out on purpose: approving a proposal, answering a question,
 * starting or assigning a step, dismissing or deleting anything are the
 * person's, made on the page, and an assistant that can make them on its own
 * word has taken them away.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isModuleId, MODULES } from '@/lib/modules';
import type { CommentTarget } from './load';
import type { DashAction } from './reply-payload';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * What the thread is told: what was done, or why nothing was.
 *
 * `redraw` is the page the action changed, when it is not the page the comment
 * was written on -- filing an idea from a plan step leaves /dev/ideas showing
 * a list the new row is missing from until something says otherwise.
 */
export type ActOutcome =
  | { ok: true; said: string; redraw?: string }
  | { ok: false; why: string };

export type ActInput = {
  supabase: Db;
  userId: string;
  /** Which kind of row the comment sits on. */
  target: CommentTarget;
  /** The row itself, not the comment. */
  id: string;
  action: DashAction;
};

/** The ideas column takes 4000 characters. */
const MAX_IDEA = 4000;

/**
 * Carry out one instruction, or say why it was not carried out.
 *
 * Nothing is done twice and nothing is done part way: each action is a single
 * write, so a failure leaves the row as it was and the thread says so.
 */
export async function carryOut(input: ActInput): Promise<ActOutcome> {
  switch (input.action.name) {
    case 'file_idea':
      return fileIdea(input);
    default:
      return {
        ok: false,
        why:
          `I did not do that: "${input.action.name}" is not one of the things I can do from a ` +
          'comment. Approving a proposal, answering a question, starting or assigning a step, ' +
          'and dismissing or deleting a row are yours to make on the page.',
      };
  }
}

/**
 * Write a new idea on the ideas page.
 *
 * Filed as a suggestion, the same as one `scripts/plan.ts idea` writes: it
 * lands under the person's own ideas rather than among them, so a thought that
 * came out of a comment is never mistaken for one they had. A comment on a
 * plan step stamps the idea with that step, which is what the ideas page shows
 * as where a suggestion came from.
 */
async function fileIdea(input: ActInput): Promise<ActOutcome> {
  const body = input.action.text?.trim();
  if (!body) {
    return { ok: false, why: 'I could not tell what to file, so nothing was written down.' };
  }
  if (body.length > MAX_IDEA) {
    return { ok: false, why: `That is longer than an idea can be (${MAX_IDEA} characters), so nothing was filed.` };
  }

  // Named `scope` rather than `module`, which Next reserves.
  const scope = input.action.module && isModuleId(input.action.module) ? input.action.module : null;
  const { error } = await input.supabase.from('ideas').insert({
    user_id: input.userId,
    body,
    module: scope,
    source: 'claude',
    // Only a plan step is a row `ideas.from_plan_item_id` can point at.
    from_plan_item_id: input.target === 'step' ? input.id : null,
  });
  if (error) return { ok: false, why: `I could not file that idea: ${error.message}` };

  const where = scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'the app as a whole';
  return {
    ok: true,
    said: `Filed on the ideas page, about ${where}, marked as my suggestion:\n\n${body}`,
    redraw: '/dev/ideas',
  };
}
