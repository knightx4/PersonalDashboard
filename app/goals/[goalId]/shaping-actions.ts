'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { goalsRoutine } from '@/lib/feedback/routine';
import { createGoalsClient } from '@/lib/goals/auth/server';
import type { SendMode } from '@/lib/goals/handover';
import { sendGoalStep } from '@/lib/goals/handover-store';
import { runInFlight } from '@/lib/goals/shaping';
import {
  answerQuestion,
  approveGoal,
  loadShaping,
  markReviewed,
  setFogAside,
  setQuestionAside,
  settleProposal,
  startGoalRun,
} from '@/lib/goals/shaping-store';

/**
 * Claude shaping a goal (plan #932): start a run on it, approve what it
 * proposed, and answer the questions it asked. And marking what the morning
 * run produced for a step as read (plan #933). Each returns a sentence to
 * show rather than throwing.
 */

export type ShapingActionState = { error?: string; message?: string; done?: number };

const Id = z.string().uuid();
const ANSWER_MAX = 20000;

function saved(message?: string): ShapingActionState {
  revalidatePath('/goals', 'layout');
  return { message, done: Date.now() };
}

/**
 * Fire the goals routine for one goal. Only the owner's account can: the run
 * spends the owner's routine allowance, whoever pressed it.
 */
// latency: pending
export async function workOnGoalAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  const user = await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  if (!(await isOwner({ user }))) {
    return { error: 'Only the account that owns this app can start a Claude run.' };
  }

  const routine = goalsRoutine();
  if (!routine.id) {
    return {
      error:
        'No goals routine on this deployment, so nothing was started. Set ' +
        'CLAUDE_GOALS_ROUTINE_ID to the routine that works goals, and ' +
        'CLAUDE_GOALS_ROUTINE_TOKEN to its token.',
    };
  }

  const client = await createGoalsClient();
  const { data: goal, error } = await client
    .from('items')
    .select('id, title')
    .eq('id', goalId.data)
    .eq('level', 'goal')
    .is('archived_at', null)
    .maybeSingle();
  if (error || !goal) return { error: 'That goal is no longer on the page.' };

  const { lastRun } = await loadShaping(client, goal.id as string);
  if (runInFlight(lastRun, Date.now())) {
    return { error: 'Claude is already working on this goal. Its changes will show here when it is done.' };
  }

  const result = await startGoalRun({
    client,
    userId: user.id,
    goal: { id: goal.id as string, title: goal.title as string },
    routine,
  });
  if (!result.ok) {
    revalidatePath(`/goals/${goalId.data}`);
    return { error: result.error };
  }
  // No message: the working line in the panel says it, with its clock (plan #961).
  return saved();
}

/**
 * Send one Claude step, or one phase, to Claude from its row (plan #1000).
 * Every rule about what may be sent is in lib/goals/handover.ts; a refusal
 * comes back as the sentence the row shows.
 */
// latency: pending
export async function sendStepAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  return handOver(form, 'send');
}

/**
 * Ask Claude to prepare one of your steps from its row (plan #1001): a run
 * that writes a draft email, a call script or a checklist into the step's
 * result and leaves the step yours and open. The rules are sendRefusal's,
 * in lib/goals/handover.ts, with mode `prepare`.
 */
// latency: pending
export async function prepareStepAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  return handOver(form, 'prepare');
}

async function handOver(form: FormData, mode: SendMode): Promise<ShapingActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  if (!(await isOwner({ user }))) {
    return { error: 'Only the account that owns this app can start a Claude run.' };
  }
  const routine = goalsRoutine();
  if (!routine.id) {
    return {
      error:
        'No goals routine on this deployment, so nothing was started. Set ' +
        'CLAUDE_GOALS_ROUTINE_ID to the routine that works goals, and ' +
        'CLAUDE_GOALS_ROUTINE_TOKEN to its token.',
    };
  }

  let sent;
  try {
    sent = await sendGoalStep({
      client: await createGoalsClient(),
      userId: user.id,
      stepId: id.data,
      routine,
      mode,
    });
  } catch {
    return {
      error: mode === 'prepare' ? 'Claude could not be asked. Try again.' : 'The step could not be sent. Try again.',
    };
  }
  if (!sent.ok) {
    // A fire that failed still wrote a failed run row, which the Runs page lists.
    revalidatePath('/goals', 'layout');
    return { error: sent.error };
  }
  if (sent.job === 'prepare') {
    return saved(`Asked Claude to prepare "${sent.title}". What it writes will show on the step, which stays yours.`);
  }
  return saved(
    sent.job === 'phase'
      ? `Sent "${sent.title}" to Claude. It will work the Claude steps in it, in order.`
      : `Sent "${sent.title}" to Claude. What it produces will show on the step.`,
  );
}

// latency: pending
export async function approveGoalAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  let opened: number | null;
  try {
    opened = await approveGoal(await createGoalsClient(), goalId.data);
  } catch {
    return { error: 'The approval could not be saved. Try again.' };
  }
  if (opened === null) return { error: 'That goal is no longer on the page.' };
  return saved(
    opened === 0
      ? 'Approved.'
      : `Approved. ${opened} ${opened === 1 ? 'step is' : 'steps are'} now live.`,
  );
}

// latency: pending
export async function answerQuestionAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which question that was.' };
  const answer = String(form.get('answer') ?? '').trim();
  if (!answer) return { error: 'Write an answer first.' };
  if (answer.length > ANSWER_MAX) return { error: 'That answer is too long.' };
  try {
    const answered = await answerQuestion(await createGoalsClient(), id.data, answer);
    if (!answered) return { error: 'That question was withdrawn or is gone.' };
  } catch {
    return { error: 'The answer could not be saved. Try again.' };
  }
  return saved();
}

/**
 * Not now on a question, or Bring back (plan #956). The question stays open
 * and unanswered; aside, it is out of the tree and off the home's waiting
 * list until it is brought back.
 */
// latency: pending
export async function setQuestionAsideAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which question that was.' };
  const aside = form.get('aside') !== '0';
  try {
    const changed = await setQuestionAside(await createGoalsClient(), id.data, aside);
    if (!changed) return { error: 'That question has been answered or is gone.' };
  } catch {
    return { error: 'Could not put the question aside. Try again.' };
  }
  return saved();
}

/** Mark a Claude step's result as read, which takes it off the home's list. */
// latency: pending
export async function reviewResultAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  try {
    const marked = await markReviewed(await createGoalsClient(), id.data);
    if (!marked) return { error: 'That result has already been marked read or is gone.' };
  } catch {
    return { error: 'Could not mark it read. Try again.' };
  }
  return saved();
}

/**
 * Approve or turn down one proposed step from its menu (plan #960). The
 * goal-level Approve above still opens everything at once.
 */
// latency: pending
export async function settleProposalAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  const approve = form.get('approve') === '1';
  let settled: number | null;
  try {
    settled = await settleProposal(await createGoalsClient(), id.data, approve);
  } catch {
    return {
      error: approve ? 'The approval could not be saved. Try again.' : 'Could not turn it down. Try again.',
    };
  }
  if (settled === null) return { error: 'That step is no longer a proposal. Reload to see it.' };
  const beneath = settled - 1;
  const more = beneath > 0 ? `, with ${beneath} beneath it` : '';
  return saved(approve ? `Approved${more}.` : `Turned down${more}.`);
}

/** Not now on a goal's fog, or Bring back (plan #960). */
// latency: pending
export async function setFogAsideAction(
  _prev: ShapingActionState,
  form: FormData,
): Promise<ShapingActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which goal that was.' };
  const aside = form.get('dismissed') !== '0';
  try {
    const changed = await setFogAside(await createGoalsClient(), id.data, aside);
    if (!changed) return { error: 'That goal no longer says what is not known.' };
  } catch {
    return { error: aside ? 'Could not put it aside. Try again.' : 'Could not bring it back. Try again.' };
  }
  return saved();
}
