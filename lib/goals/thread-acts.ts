import 'server-only';

import { readSubjectOrNull, recordDashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import type { DashThreadActs } from '@/lib/dash/registry';
import { isDate } from '@/lib/ask/db';
import { resolveArea, resolveGoalTarget, withSubSteps, type ReplyArea, type ReplyRefs } from '@/lib/goals/comments';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { formatDue } from '@/lib/goals/due-precision';
import { saveErrand } from '@/lib/goals/errand-store';
import type { StepNode } from '@/lib/goals/steps';
import type { GoalStatus } from '@/lib/goals/tree';
import { resolveRoutineId, type RoutineTarget } from '@/lib/feedback/routine';
import { runInFlight } from '@/lib/goals/shaping';
import { approveGoal, loadShaping, startGoalRun } from '@/lib/goals/shaping-store';
import { moveStepToGoal, setStepArchived } from '@/lib/goals/steps-store';
import { loadAreas } from '@/lib/goals/store';

/**
 * The goal thread's direct changes to the step a comment is on (plan #2035,
 * "Let Dash move and tidy goal steps from chat").
 *
 * Each act writes through the store function the goal page's own buttons
 * use, made with the person's client, then records each row it changed with
 * recordDashAction holding the values from before, so Home lists it with an
 * Undo that puts the row back. Making a step an errand changes two rows and
 * records two changes. Each returns the sentence added under
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
  goalId: string;
  goalTitle: string;
  /** The goal's status; only a proposed goal can be approved (plan #2035.3). */
  goalStatus: GoalStatus;
  /** Every step on the goal, so the proposed ones can be recorded before approving. */
  steps: StepNode[];
  /** The area the goal is in, where an errand made from one of its steps goes by default. */
  goalAreaId: string;
  /** The step the comment is on, or null when it is on the goal itself. */
  step: StepNode | null;
  refs: ReplyRefs;
  /** Whether the person owns the app, the only account that can start a run. */
  canRun: boolean;
  /** The goals routine a run is fired at. */
  routine: RoutineTarget;
  /** Whether the goal is an errand, and the date it is due by (plan #2035.4). */
  goalErrand: boolean;
  goalDueOn: string | null;
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

/**
 * Make the step its own errand (plan #2035.2): a new errand under the area
 * the comment names, or the goal's own, titled as the step, carrying its
 * notes and any the comment adds, due on the date the comment gives or the
 * step's own. Then the step is archived. No run is started.
 *
 * Two rows change, so two changes are recorded, each with its own Undo on
 * Home: the errand added, which Undo deletes while nothing hangs off it, and
 * the step archived, which Undo brings back. With no date in the comment or
 * on the step nothing is written, and the model asks for one.
 */
async function promoteStepToErrand(ctx: GoalActContext, args: unknown): ReturnType<DashThreadActs> {
  const { step } = ctx;
  if (!step) return { ok: false, error: ON_THE_GOAL };
  if (step.status !== 'open') {
    return { ok: false, error: 'That step is closed, so nothing was changed. Only an open step can become an errand.' };
  }
  const raw = fields(args);
  const dueOn = isDate(raw.due_on) ? raw.due_on : step.dueOn;
  if (!dueOn) {
    return {
      ok: false,
      error: 'The step has no due date and the comment gives none, so nothing was changed. An errand needs a date: ask them which day it is due.',
    };
  }
  let areas: ReplyArea[];
  try {
    areas = await loadAreas(ctx.client);
  } catch (error) {
    return { ok: false, error: `Nothing was changed: ${reason(error)}.` };
  }
  const placed = resolveArea(areas, raw.area, ctx.goalAreaId);
  if (!placed.ok) return placed;

  const notes = typeof raw.notes === 'string' ? raw.notes.trim() : '';
  const detail = [step.detail?.trim(), notes].filter(Boolean).join('\n\n') || null;
  const saved = await saveErrand({
    client: ctx.client,
    userId: ctx.userId,
    areaId: placed.area.id,
    title: step.title,
    dueOn,
    detail,
  });
  if (!saved.ok) return { ok: false, error: `Nothing was changed: ${saved.error}` };

  const errandRef = toRef('goals.items', saved.goalId);
  const due = formatDue(dueOn, 'day');
  const added = `Made "${step.title}" its own errand in ${placed.area.name}, due ${due}.`;
  await recordDashAction(ctx.dash, {
    surface: 'thread',
    kind: 'promote_step_to_errand',
    subjectRef: errandRef,
    op: 'insert',
    summary: added,
  });
  const link = `[${step.title}](/goals/${saved.goalId})`;

  const stepRef = toRef('goals.items', step.id);
  const before = await readSubjectOrNull(ctx.dash, stepRef);
  let archived = false;
  try {
    archived = await setStepArchived(ctx.client, step.id, true);
  } catch {
    archived = false;
  }
  if (!archived) {
    return {
      ok: true,
      recorded: true,
      kind: 'promote_step_to_errand',
      said: `${added} The errand is ${link}. The step could not be archived, so it is still on "${ctx.goalTitle}".`,
    };
  }
  const gone = `Archived "${step.title}" from "${ctx.goalTitle}"${withSubSteps(step)}, now that it is an errand.`;
  await recordDashAction(ctx.dash, {
    surface: 'thread',
    kind: 'promote_step_to_errand',
    subjectRef: stepRef,
    op: 'update',
    beforeValues: before,
    summary: gone,
  });
  return {
    ok: true,
    recorded: true,
    kind: 'promote_step_to_errand',
    said: `${added} The errand is ${link}. ${gone} Undo on Home takes back either change.`,
  };
}

function proposedIds(nodes: StepNode[]): string[] {
  return nodes.flatMap((node) => [...(node.status === 'proposed' ? [node.id] : []), ...proposedIds(node.children)]);
}

/**
 * Approve the goal, when Dash proposed it (plan #2035.3): the store function
 * the page's Approve button calls, which opens the goal and every proposed
 * step under it. The page offers Approve for a goal whose status is
 * 'proposed', so that is the test here; a goal the person added, or one
 * already open, is refused with the reason. It works from a comment on the
 * goal or on any step under it.
 *
 * Each row it opens is recorded with its values before, so Home lists an
 * Undo for the goal and for each step.
 */
async function approveProposedGoal(ctx: GoalActContext): ReturnType<DashThreadActs> {
  if (ctx.goalStatus !== 'proposed') {
    return {
      ok: false,
      error: `"${ctx.goalTitle}" is not a goal Dash proposed that is waiting on approval, so nothing was changed. Tell them that approving is theirs to do, or already done.`,
    };
  }
  const goalRef = toRef('goals.items', ctx.goalId);
  const stepRefs = proposedIds(ctx.steps).map((id) => toRef('goals.items', id));
  const goalBefore = await readSubjectOrNull(ctx.dash, goalRef);
  const stepsBefore = await Promise.all(stepRefs.map((ref) => readSubjectOrNull(ctx.dash, ref)));

  let opened: number | null;
  try {
    opened = await approveGoal(ctx.client, ctx.goalId);
  } catch (error) {
    return { ok: false, error: `It was not approved: ${reason(error)}.` };
  }
  if (opened === null) return { ok: false, error: 'It was not approved: the goal is no longer on the page.' };

  const live = opened === 0 ? '' : ` ${opened} ${opened === 1 ? 'step is' : 'steps are'} now live.`;
  const sentence = `Approved "${ctx.goalTitle}".${live}`;
  await recordDashAction(ctx.dash, {
    surface: 'thread',
    kind: 'approve_goal',
    subjectRef: goalRef,
    op: 'update',
    beforeValues: goalBefore,
    summary: sentence,
  });
  for (const [index, ref] of stepRefs.entries()) {
    await recordDashAction(ctx.dash, {
      surface: 'thread',
      kind: 'approve_goal',
      subjectRef: ref,
      op: 'update',
      beforeValues: stepsBefore[index],
      summary: `Opened a step of "${ctx.goalTitle}" by approving the goal.`,
    });
  }
  return { ok: true, recorded: true, kind: 'approve_goal', said: `${sentence} Undo on Home takes it back.` };
}

const NOT_AN_ERRAND =
  '"%" is not an errand, so no run was started. Only an errand is started from a comment this way; a goal or a step of one goes to the goals routine with the comment.';

/**
 * Start Dash on the errand the thread is on (plan #2035.4): the run the
 * errand page's Ask Dash button starts, with the errand and its date in the
 * brief, so it costs the same as pressing that button. Refused when the goal
 * is not an errand, when a run is already going, and when no routine can be
 * started from here.
 *
 * A run that has begun cannot be taken back, so the change is recorded as
 * not undoable: Home lists it with the reason in place of an Undo.
 */
async function startErrandRun(ctx: GoalActContext): ReturnType<DashThreadActs> {
  if (!ctx.goalErrand || !ctx.goalDueOn) {
    return { ok: false, error: NOT_AN_ERRAND.replace('%', ctx.goalTitle) };
  }
  if (!ctx.canRun) {
    return { ok: false, error: 'No run was started: only the account that owns this app can start Dash on an errand.' };
  }
  if (!resolveRoutineId(ctx.routine.id)) {
    return {
      ok: false,
      error:
        'No run was started: no goals routine is set on this deployment (CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN). Say so, and that Ask Dash on the errand will work once it is.',
    };
  }
  try {
    const { lastRun } = await loadShaping(ctx.client, ctx.goalId);
    if (runInFlight(lastRun, Date.now())) {
      return {
        ok: false,
        error: `No run was started: Dash is already working on "${ctx.goalTitle}". Its changes will show on the errand when it is done.`,
      };
    }
    const started = await startGoalRun({
      client: ctx.client,
      userId: ctx.userId,
      goal: { id: ctx.goalId, title: ctx.goalTitle, errandDueOn: ctx.goalDueOn },
      routine: ctx.routine,
      surface: 'thread',
    });
    if (!started.ok) return { ok: false, error: `No run was started: ${started.error}` };
  } catch (error) {
    return { ok: false, error: `No run was started: ${reason(error)}.` };
  }

  const sentence = `Started Dash on the errand "${ctx.goalTitle}", due ${formatDue(ctx.goalDueOn, 'day')}.`;
  await recordDashAction(ctx.dash, {
    surface: 'thread',
    kind: 'start_errand_run',
    subjectRef: toRef('goals.items', ctx.goalId),
    op: 'update',
    summary: sentence,
    noUndo: 'A run that has started cannot be taken back. It can be stopped on the errand.',
  });
  return {
    ok: true,
    recorded: true,
    kind: 'start_errand_run',
    said: `${sentence} What it does will show on the errand when it is done.`,
  };
}

/** The step acts, by tool name. */
export function stepActs(ctx: GoalActContext): Record<string, GoalAct> {
  return {
    move_goal_step: (args) => moveGoalStep(ctx, args),
    archive_goal_step: () => archiveGoalStep(ctx),
    promote_step_to_errand: (args) => promoteStepToErrand(ctx, args),
    approve_goal: () => approveProposedGoal(ctx),
    start_errand_run: () => startErrandRun(ctx),
  };
}
