import { noButton, sameAs } from './runs';
import { isUuid } from '@/lib/ask/db';
import { GOAL_RUN_CHANGE_KINDS, type GoalRunChangeKind } from '@/lib/ask/goals-changes';
import { toRef } from '@/lib/core/refs';
import { stepHref } from '@/lib/goals/all-goals';
import { sendGoalStep } from '@/lib/goals/handover-store';
import { runInFlight } from '@/lib/goals/shaping';
import { loadShaping, startGoalRun } from '@/lib/goals/shaping-store';
import { pickGoal, QUESTION_MAX, takeOnHref } from '@/lib/goals/take-on';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * Starting the goals routine from Ask Dash: the two Ask Dash buttons on
 * Goals, as tools (note on the goal thread's hand-offs having no Ask
 * equivalent).
 *
 *   start_goal_run  the goal page's Ask Dash: a long session that maps the
 *                   goal (stages, Dash steps, information steps, questions),
 *                   with what they asked for in its brief when they asked
 *                   for more than the map. A goal comment's pass_to_routine
 *                   and start_errand_run start the same run.
 *   work_goal_step  a step row's Ask Dash: a Dash step or a phase worked, a
 *                   step of theirs prepared. A goal comment's take_step.
 *
 * Both call the function the button's server action calls, on the person's
 * own goals client, and are refused as the buttons are: for anyone but the
 * owner (a run spends the owner's routine allowance), with no routine set,
 * and while a run on the goal is going. A run that has begun cannot be taken
 * back, so each is recorded as not undoable, with the reason in place of an
 * Undo, as the thread's start_errand_run is.
 *
 * In the app only: the connector has no goalRoutine port. The third,
 * take_on_for_goal (plan #2778.8), hands a goal a question from Ask Dash or
 * a Claude chat; the connector gives it a goalRoutine port of its own
 * (lib/connector/writes.ts), and the run is reported back by
 * lib/goals/take-on-report.ts.
 */

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

/** The most of what they asked for that goes into a brief, as the step row's box allows. */
export const ASKED_MAX = 4000;

const ITEM = 'goals.items';
const GOAL_PATHS = ['/goals', '/goals/all', '/home'];
const goalHref = (id: string) => `/goals/${id}`;

const NO_UNDO = 'A run that has started cannot be taken back. What it changes on the goal shows there with its own Undo.';

class Refused extends Error {}

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function named(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

async function ownItem(ctx: DashWriteContext, id: string, what: string): Promise<Row> {
  if (!id) throw new Refused(`${what} is missing: give the goals.items ref a lookup returned.`);
  if (!isUuid(id)) throw new Refused(`${what} must be a goals.items ref, as a lookup returned it.`);
  const goals = await ctx.db('goals');
  const { data, error } = await goals.from('items').select('*').eq('id', id).eq('user_id', ctx.userId).maybeSingle();
  if (error) throw new Error(`Reading goals.items failed: ${error.message}`);
  if (!data) throw new Refused(`There is nothing of theirs with that ${what}. Look it up first.`);
  const row = data as Row;
  if (row.archived_at != null) throw new Refused('That is archived. It is restored first, with change_goal or change_goal_step.');
  return row;
}

/** The id of the goal at the top of a step's branch, for the link. */
async function goalIdAbove(ctx: DashWriteContext, step: Row): Promise<string> {
  const goals = await ctx.db('goals');
  let at = step.parent_id as string | null;
  for (let depth = 0; at && depth < 20; depth++) {
    const { data } = await goals.from('items').select('id, level, parent_id').eq('id', at).eq('user_id', ctx.userId).maybeSingle();
    const up = data as Row | null;
    if (!up) break;
    if (up.level === 'goal') return up.id as string;
    at = up.parent_id as string | null;
  }
  throw new Refused('Dash could not find the goal that step sits under.');
}

/** The asked-for words, within the brief's limit. */
function askedOf(args: Args): string | null {
  const asked = text(args, 'instruction');
  if (asked.length > ASKED_MAX) throw new Refused(`Keep instruction under ${ASKED_MAX} characters.`);
  return asked || null;
}

/** The routine, when this person can start it from here; a refusal saying why otherwise. */
async function routineFor(ctx: DashWriteContext) {
  if (!ctx.enabledModules.includes('goals')) throw new Refused('The Goals workspace is switched off, so no run was started.');
  if (!ctx.goalRoutine) throw new Refused('No run can be started from here. Ask Dash on the goal page starts it.');
  const { canRun, routine } = await ctx.goalRoutine();
  if (!canRun) throw new Refused('No run was started: only the account that owns this app can start Dash on a goal.');
  // As the goal page's button checks, rather than resolveRoutineId, which
  // falls back to the shared routine and would send a map to the plan's.
  if (!routine.id) {
    throw new Refused(
      'No run was started: no goals routine is set on this deployment (CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN). Say so.',
    );
  }
  return routine;
}

function made(
  kind: GoalRunChangeKind,
  row: Row,
  words: { verb: string; what: string; rest: string; href: string; where: string; goalId: string; summary: string },
): DashWriteResult {
  const id = row.id as string;
  return {
    ok: true,
    kind,
    input: {
      verb: words.verb,
      what: words.what,
      rest: words.rest,
      href: words.href,
      where: words.where,
      paths: [...GOAL_PATHS, goalHref(words.goalId)],
    },
    subjectRef: toRef(ITEM, id),
    op: 'update',
    before: row,
    after: row,
    summary: words.summary,
    undo: { none: NO_UNDO },
    row: { table: ITEM, ref: id, title: words.what, href: words.href },
  };
}

async function startRun(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  const routine = await routineFor(ctx);
  const goal = await ownItem(ctx, text(args, 'goal_ref'), 'goal_ref');
  if (goal.level !== 'goal') throw new Refused('That is a step, not a goal. A step is worked with work_goal_step.');
  if (goal.status === 'done' || goal.status === 'dropped') {
    throw new Refused('That goal is closed. Reopen it with change_goal first.');
  }
  const asked = askedOf(args);
  const id = goal.id as string;
  const title = named(goal.title, 'the goal');
  const client = await ctx.goals({});

  const { lastRun } = await loadShaping(client, id);
  if (runInFlight(lastRun, ctx.now ?? Date.now())) {
    throw new Refused(`No run was started: Dash is already working on "${title}". Its changes show on the goal when it is done.`);
  }
  const started = await startGoalRun({
    client,
    userId: ctx.userId,
    goal: { id, title, errandDueOn: goal.errand ? ((goal.due_on as string | null) ?? null) : null },
    asked,
    routine,
    surface: 'thread',
  });
  if (!started.ok) throw new Refused(`No run was started: ${started.error}`);

  const href = goalHref(id);
  return made('start_goal_run', goal, {
    verb: 'Started Dash on',
    what: title,
    rest: asked ? ', with what you asked for' : '',
    href,
    where: 'Open the goal',
    goalId: id,
    summary: `Dash started mapping the goal "${title}"${asked ? ', with what they asked for in its brief' : ''}.`,
  });
}

async function workStep(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  const routine = await routineFor(ctx);
  const step = await ownItem(ctx, text(args, 'step_ref'), 'step_ref');
  if (step.level !== 'step') throw new Refused('That is a goal, not a step. A goal is mapped with start_goal_run.');
  const asked = askedOf(args);
  const goalId = await goalIdAbove(ctx, step);
  const sent = await sendGoalStep({
    client: await ctx.goals({}),
    userId: ctx.userId,
    stepId: step.id as string,
    routine,
    surface: 'thread',
    mode: 'ask',
    ...(asked ? { asked, askedOn: 'chat' as const } : {}),
  });
  if (!sent.ok) throw new Refused(`No run was started: ${sent.error}`);

  const title = named(sent.title, 'the step');
  const href = stepHref(goalId, step.id as string);
  const [verb, rest, summary] =
    sent.job === 'prepare'
      ? ['Started Dash preparing', ', which stays yours', `Dash started preparing the step "${title}", which stays theirs.`]
      : sent.job === 'phase'
        ? ['Started Dash on the phase', '', `Dash started working Dash's steps in the phase "${title}", in order.`]
        : ['Started Dash on', '', `Dash started working the step "${title}".`];
  return made('work_goal_step', step, { verb, what: title, rest, href, where: 'Open the step', goalId, summary });
}

/** Their open goals, for picking the one a question is about. */
async function openGoals(ctx: DashWriteContext) {
  const goals = await ctx.db('goals');
  const { data, error } = await goals
    .from('items')
    .select('id, title, acceptance')
    .eq('user_id', ctx.userId)
    .eq('level', 'goal')
    .eq('status', 'open')
    .is('archived_at', null)
    .limit(200);
  if (error) throw new Error(`Reading goals.items failed: ${error.message}`);
  return (data ?? []) as { id: string; title: string; acceptance: string | null }[];
}

/**
 * A question handed to a goal (plan #2778.8): a run of its own on the goal,
 * with the question and where it came from on the run row, so the goal's
 * Dashboard shows it while it runs and the app reports back when it ends.
 */
async function takeOn(ctx: DashWriteContext, args: Args): Promise<DashWriteResult> {
  const question = text(args, 'question');
  if (!question) throw new Refused('question is missing: pass what they asked, in their words.');
  if (question.length > QUESTION_MAX) throw new Refused(`Keep question under ${QUESTION_MAX} characters.`);
  const routine = await routineFor(ctx);

  let goal: Row;
  const ref = text(args, 'goal_ref');
  if (ref) {
    goal = await ownItem(ctx, ref, 'goal_ref');
    if (goal.level !== 'goal') throw new Refused('That is a step, not a goal. Name the goal it sits under.');
  } else {
    const picked = pickGoal(question, await openGoals(ctx));
    if (picked.kind === 'ask') {
      if (picked.candidates.length === 0) {
        throw new Refused('They have no open goal to hand this to. Offer to add one with add_goal first.');
      }
      const names = picked.candidates.map((g) => `"${g.title}" (${g.id})`).join(', ');
      throw new Refused(
        `Nothing was started: it is not clear which goal this is for. Ask them which of these, then call again with its goal_ref: ${names}.`,
      );
    }
    goal = await ownItem(ctx, picked.goal.id, 'goal_ref');
  }
  if (goal.status !== 'open') throw new Refused('That goal is not open. Reopen it with change_goal first.');

  const id = goal.id as string;
  const title = named(goal.title, 'the goal');
  const client = await ctx.goals({});
  const { lastRun } = await loadShaping(client, id);
  if (runInFlight(lastRun, ctx.now ?? Date.now())) {
    throw new Refused(`Nothing was started: Dash is already working on "${title}". Ask again once that finishes.`);
  }
  const origin = ctx.origin ?? { kind: 'ask_dash' as const, ref: null };
  const started = await startGoalRun({
    client,
    userId: ctx.userId,
    goal: { id, title },
    routine,
    surface: 'thread',
    question: {
      text: question,
      origin: origin.kind,
      originRef: origin.kind === 'ask_dash' ? origin.ref : null,
    },
  });
  if (!started.ok) throw new Refused(`Nothing was started: ${started.error}`);

  const href = takeOnHref(id, started.runId);
  return made('take_on_for_goal', goal, {
    verb: 'Handed',
    what: title,
    rest: ' a question to work out',
    href,
    where: 'Open the goal',
    goalId: id,
    summary: `Dash started working out "${question.length > 120 ? `${question.slice(0, 119)}…` : question}" on the goal "${title}".`,
  });
}

function guarded(run:(ctx: DashWriteContext, args: Args) => Promise<DashWriteResult>) {
  return async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const args = input && typeof input === 'object' ? (input as Args) : {};
    try {
      return await run(ctx, args);
    } catch (error) {
      if (error instanceof Refused) return { ok: false, error: error.message };
      console.error('goal run write failed', error);
      return { ok: false, error: 'No run was started. Tell them nothing was started.' };
    }
  };
}

const STARTED =
  'It is started: it shows under your answer. Say in your answer what Dash is doing and that it fills in on the page over the next several minutes, and cite the row this returned.';

const INSTRUCTION = {
  type: 'string',
  description:
    'What they asked for beyond the plain job, in their words with what you know of why ("a ranked shortlist with reach, target and safety reasons"). Leave it out when they asked for no more than that.',
} as const;

/** Ask's tools that start the goals routine, in the order the model is sent them. */
export const GOAL_RUN_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  {
    name: 'start_goal_run',
    kind: 'write',
    inAppOnly: true,
    runs: sameAs(['app/goals/[goalId]/shaping-actions.ts#workOnGoalAction', 'lib/goals/shaping-store.ts#startGoalRun']),
    definition: {
      name: 'start_goal_run',
      description:
        'Start Dash mapping one of their goals, when they ask you to map it out, plan it, break it down, research for it or rework its steps ("add this goal and map it out fully", "plan my grad school goal"). ' +
        "It is the goal page's Ask Dash: a long run, several minutes or more, that lays out every step from where they are to the goal's done-when, pulls in what their records hold, researches on the web, works the research steps it adds, makes the choices it can and asks only what it cannot settle. " +
        'A goal you just added with add_goal can be passed straight away, by the ref it returned. Pass instruction when they asked for something beyond the map. ' +
        'The request is the go-ahead: call it without asking them to confirm. Refused while a run on the goal is going, for anyone but the account that owns the app, and on a closed goal. ' +
        `Name the goal by its goals.items ref. ${STARTED}`,
      input_schema: {
        type: 'object',
        properties: {
          goal_ref: { type: 'string', description: 'The goals.items ref of the goal, from add_goal or a lookup.' },
          instruction: INSTRUCTION,
        },
        required: ['goal_ref'],
        additionalProperties: false,
      },
    },
    apply: guarded(startRun),
  },
  {
    name: 'work_goal_step',
    kind: 'write',
    inAppOnly: true,
    runs: sameAs(['app/goals/[goalId]/shaping-actions.ts#askDashStepAction', 'lib/goals/handover-store.ts#sendGoalStep']),
    definition: {
      name: 'work_goal_step',
      description:
        "Start Dash on one step under their goals, when they ask you to do it, work it or get it ready (\"do the research step\", \"draft that email for me\"). It is the step row's Ask Dash: a step of Dash's or a phase is worked in a run of its own, and a step of theirs is prepared (a draft, a script, a checklist written into it) and stays theirs. " +
        'Pass instruction when they said what to produce or how. The request is the go-ahead: call it without asking them to confirm. Refused for a step that is not ready, while a run on it is going, and for anyone but the account that owns the app. ' +
        `Name the step by the goals.items ref a lookup returned. ${STARTED}`,
      input_schema: {
        type: 'object',
        properties: {
          step_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the step.' },
          instruction: INSTRUCTION,
        },
        required: ['step_ref'],
        additionalProperties: false,
      },
    },
    apply: guarded(workStep),
  },
  {
    name: 'take_on_for_goal',
    kind: 'write',
    runs: noButton(
      'A question handed to a goal comes from a chat; the goal page’s own Ask Dash leaves a comment on the goal instead.',
    ),
    definition: {
      name: 'take_on_for_goal',
      description:
        'Hand one of their goals a question to figure out, when they ask Dash to work something out for a goal they have ("should I consolidate my loans", "work out which of these programs fits me"). ' +
        'Dash works it in a run of its own on the goal, several minutes or more: it reads their records, researches, writes the answer as a file on the goal and suggests steps or dashboard tiles that wait there on Add and No. The work shows on the goal while it runs, and when it ends they get a notification and a reply in this conversation, both opening the goal at the answer. ' +
        'Pass the question in their words. Name the goal by its goals.items ref when you know it; without one the goal is picked from the question, and when that is unclear the call names the likeliest goals: ask them which and call again. ' +
        'The request is the go-ahead: call it without asking them to confirm, and do not answer the question yourself first. Refused while another run on the goal is going, on a goal that is not open, and for anyone but the account that owns the app. ' +
        STARTED,
      input_schema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'What they want figured out, in their words, with what you know of why.',
          },
          goal_ref: {
            type: 'string',
            description: 'The goals.items ref of the goal, from a lookup. Leave it out to pick the goal from the question.',
          },
        },
        required: ['question'],
        additionalProperties: false,
      },
    },
    apply: guarded(takeOn),
  },
];

/** The kinds these tools record, for the lists every write kind is in. */
export { GOAL_RUN_CHANGE_KINDS };
