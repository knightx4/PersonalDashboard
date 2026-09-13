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
import { handStepToClaude } from '@/lib/plan/handover';
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
 * The parts of a plan row that may be rewritten, and what each is called.
 *
 * A whitelist rather than a check against a list of forbidden columns, because
 * the forbidden ones are the point: a step's status, its assignee, whether it
 * has been approved and a decision's answer are the person's, made on the page,
 * and a column that is not named here cannot be written from a comment however
 * the instruction was phrased. The aliases are what an instruction actually
 * calls them -- "the done-when", "the acceptance criteria" -- so a reword does
 * not fail on the name it was given.
 */
const STEP_FIELDS: Record<string, { column: 'title' | 'detail' | 'acceptance'; word: string }> = {
  title: { column: 'title', word: 'the title' },
  detail: { column: 'detail', word: 'the detail' },
  done_when: { column: 'acceptance', word: 'the done-when' },
  acceptance: { column: 'acceptance', word: 'the done-when' },
  acceptance_criteria: { column: 'acceptance', word: 'the done-when' },
};

/** "the done-when", "Done When", "acceptance criteria" — all the same field. */
function fieldNamed(named: string | null): (typeof STEP_FIELDS)[string] | undefined {
  const key = (named ?? '')
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[\s-]+/g, '_');
  return STEP_FIELDS[key];
}

/** What a title and the two long columns hold, from migration 0051. */
const MAX_TITLE = 200;
const MAX_DETAIL = 4000;

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
    case 'reword':
      return reword(input);
    case 'send_step':
      return sendStep(input);
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

/**
 * Rewrite the wording of the row the comment is on.
 *
 * An idea's text, or a step's title, detail or done-when, and nothing else.
 * The old wording goes back into the thread with the new: that is what makes
 * this reversible by hand, and it is the whole of why acting straight away is
 * safe -- a misread instruction costs a copy and paste rather than a row
 * nobody can reconstruct.
 */
async function reword(input: ActInput): Promise<ActOutcome> {
  const text = input.action.text?.trim();
  if (!text) {
    return { ok: false, why: 'I could not tell what to write instead, so nothing was changed.' };
  }

  if (input.target === 'idea') {
    if (text.length > MAX_IDEA) {
      return { ok: false, why: `That is longer than an idea can be (${MAX_IDEA} characters), so nothing was changed.` };
    }
    const { data } = await input.supabase
      .from('ideas')
      .select('body')
      .eq('id', input.id)
      .maybeSingle();
    const was = (data as { body: string } | null)?.body ?? null;
    if (was === null) return { ok: false, why: 'That idea is not there any more, so nothing was changed.' };

    const { error } = await input.supabase.from('ideas').update({ body: text }).eq('id', input.id);
    if (error) return { ok: false, why: `I could not change it: ${error.message}` };
    return { ok: true, said: rewritten('the idea', text, was) };
  }

  if (input.target === 'step') {
    const field = fieldNamed(input.action.field);
    if (!field) {
      return {
        ok: false,
        why:
          `I did not change anything: "${input.action.field ?? 'that'}" is not a part of a step I ` +
          'can rewrite. The title, the detail and the done-when are; the status, who it is ' +
          'assigned to, whether it is approved and a question\'s answer are yours on the page.',
      };
    }
    const limit = field.column === 'title' ? MAX_TITLE : MAX_DETAIL;
    if (text.length > limit) {
      return { ok: false, why: `That is longer than ${field.word} can be (${limit} characters), so nothing was changed.` };
    }

    const { data } = await input.supabase
      .from('plan_items')
      .select(field.column)
      .eq('id', input.id)
      .maybeSingle();
    if (!data) return { ok: false, why: 'That step is not there any more, so nothing was changed.' };
    const was = (data as Record<string, string | null>)[field.column];

    const { error } = await input.supabase
      .from('plan_items')
      .update({ [field.column]: text })
      .eq('id', input.id);
    if (error) return { ok: false, why: `I could not change it: ${error.message}` };
    return { ok: true, said: rewritten(field.word, text, was) };
  }

  return {
    ok: false,
    why: 'I can only reword an idea or a plan step, and this is a raise, so nothing was changed.',
  };
}

/** What was written, and what was there before it. */
function rewritten(what: string, now: string, was: string | null): string {
  return [`Rewrote ${what}:`, '', now, '', 'It said:', '', was ?? '(nothing)'].join('\n');
}

/**
 * Which step to send, when the row this is on is not itself a step.
 *
 * A comment on a step means that step. A raise means whichever step its
 * consequence named, because a raise whose answer is "build #342" has no step
 * of its own to point at. The number is looked up under the caller's own id,
 * so a number belonging to somebody else finds nothing.
 */
async function stepNamed(input: ActInput): Promise<string | null> {
  const number = Number(input.action.text?.trim().replace(/^#/, ''));
  if (!Number.isInteger(number) || number <= 0) return null;

  const { data } = await input.supabase
    .from('plan_items')
    .select('id')
    .eq('user_id', input.userId)
    .eq('number', number)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Hand a plan step to a session, and start it now.
 *
 * The same rules as the button on the plan page, because they are the same
 * function: a proposal is not work yet, a question and a blocked step are
 * waiting on the person rather than on a session, and a feature already being
 * worked takes one session and not two. Which of those refused it is what the
 * thread says, so a comment that started nothing says why.
 */
async function sendStep(input: ActInput): Promise<ActOutcome> {
  const id = input.target === 'step' ? input.id : await stepNamed(input);
  if (!id) {
    return {
      ok: false,
      why:
        'This is not a plan step and nothing here names one by number, so nothing was started.',
    };
  }

  const sent = await handStepToClaude({
    supabase: input.supabase,
    userId: input.userId,
    id,
  });
  if (!sent.ok) return { ok: false, why: `I did not send it: ${sent.error}` };

  const withThem =
    sent.beneath === 0
      ? ''
      : `, with the ${sent.beneath === 1 ? 'step' : `${sent.beneath} steps`} beneath it`;
  return {
    ok: true,
    said: `Sent #${sent.number} ${sent.title} to be built${withThem}. ${sent.detail}`,
  };
}
