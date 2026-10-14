import 'server-only';

import { readSubjectOrNull, recordDashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import type { DashThreadActs } from '@/lib/dash/registry';
import { resolveGoalTarget, withSubSteps, type ReplyRefs } from '@/lib/goals/comments';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { StepNode } from '@/lib/goals/steps';
import { moveStepToGoal, setStepArchived } from '@/lib/goals/steps-store';

/**
 * The goal thread's direct changes to the step a comment is on (plan #2035,
 * "Let Dash move and tidy goal steps from chat").
 *
 * Each act is one write through the store function the goal page's own
 * buttons use, made with the person's client, then recorded with
 * recordDashAction holding the step's values from before, so Home lists it
 * with an Undo that puts the row back. Each returns the sentence added under
 * Dash's reply, or the reason nothing was changed, which the model turns into
 * its answer or a question.
 *
 * lib/goals/ask.ts spreads `stepActs` into the thread's acts beside
 * file_goal_record and schedule_goal_step; the tool definitions are in
 * lib/dash/thread-tools.ts under the same names. A new act is a function
 * here, an entry in `stepActs`, and a `write` there.
 */

/** What every act is handed: the comment's goal and step, and the person's clients. */
export type GoalActContext = {
  /** The person's own goals client. */
  client: GoalsSupabaseClient;
  userId: string;
  /** The person's clients, for core.dash_actions. */
  dash: DashActionDeps;
  goalTitle: string;
  /** The step the comment is on, or null when it is on the goal itself. */
  step: StepNode | null;
  refs: ReplyRefs;
};

/** One of the thread's own acts, by the tool's arguments. */
export type GoalAct = (args: unknown) => ReturnType<DashThreadActs>;

const ON_THE_GOAL =
  'This comment is on the goal itself, not on a step, so nothing was changed. Say it is done from a comment on the step it means.';

function fields(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'no reason given';
}

/** Move the step under another of their open goals, taking its sub-steps along. */
async function moveGoalStep(ctx: GoalActContext, args: unknown): ReturnType<DashThreadActs> {
  const { step } = ctx;
  if (!step) return { ok: false, error: ON_THE_GOAL };
  const raw = fields(args);
  const target = resolveGoalTarget(ctx.refs.goals, raw.goal, raw.named);
  if (!target.ok) return target;

  const ref = toRef('goals.items', step.id);
  const before = await readSubjectOrNull(ctx.dash, ref);
  let moved: Awaited<ReturnType<typeof moveStepToGoal>>;
  try {
    moved = await moveStepToGoal(ctx.client, step.id, target.goal.id);
  } catch (error) {
    return { ok: false, error: `It was not moved: ${reason(error)}.` };
  }
  if (!moved) {
    return { ok: false, error: 'It was not moved: the step or that goal is no longer on the page.' };
  }

  const sentence = `Moved "${step.title}" from "${ctx.goalTitle}" to "${target.goal.title}"${withSubSteps(step)}.`;
  await recordDashAction(ctx.dash, {
    surface: 'thread',
    kind: 'move_goal_step',
    subjectRef: ref,
    op: 'update',
    beforeValues: before,
    summary: sentence,
  });
  return {
    ok: true,
    recorded: true,
    kind: 'move_goal_step',
    said: moved.unlinked
      ? `${sentence} It had been counting towards "${target.goal.title}" as a linked step, and now sits there instead.`
      : sentence,
  };
}

/** Archive the step, with its sub-steps out of view beneath it. Never a delete. */
async function archiveGoalStep(ctx: GoalActContext): ReturnType<DashThreadActs> {
  const { step } = ctx;
  if (!step) return { ok: false, error: ON_THE_GOAL };

  const ref = toRef('goals.items', step.id);
  const before = await readSubjectOrNull(ctx.dash, ref);
  let archived: boolean;
  try {
    archived = await setStepArchived(ctx.client, step.id, true);
  } catch (error) {
    return { ok: false, error: `It was not archived: ${reason(error)}.` };
  }
  if (!archived) return { ok: false, error: 'It was not archived: it is already archived or no longer there.' };

  const sentence = `Archived "${step.title}" from "${ctx.goalTitle}"${withSubSteps(step)}.`;
  await recordDashAction(ctx.dash, {
    surface: 'thread',
    kind: 'archive_goal_step',
    subjectRef: ref,
    op: 'update',
    beforeValues: before,
    summary: sentence,
  });
  return { ok: true, recorded: true, kind: 'archive_goal_step', said: `${sentence} Undo on Home brings it back.` };
}

/** The step acts, by tool name. */
export function stepActs(ctx: GoalActContext): Record<string, GoalAct> {
  return {
    move_goal_step: (args) => moveGoalStep(ctx, args),
    archive_goal_step: () => archiveGoalStep(ctx),
  };
}
