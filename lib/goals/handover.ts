/**
 * Sending one step or one phase of a goal to Claude from its row (plan #1000).
 *
 * "Work on this" hands Claude a whole goal and the morning run takes every
 * ready Claude step at once. This is the smaller hand-over: one Claude step,
 * or one phase (a step with sub-steps), worked by a run of its own with job
 * `step` or `phase`. The dev plan's send button in app/dev/plan is the model,
 * and so is lib/plan/handover.ts: the rules about what may be sent live here
 * rather than in the button, so a later way in (an @dash comment, the night
 * run) refuses the same things.
 *
 * Prepare (plan #1001) goes the same way for a step of yours: a run with job
 * `prepare` writes what you need to do it (a draft email, a call script, a
 * checklist) into the step's result, and leaves the step yours and open.
 *
 * Pure, so the row can ask whether to offer Send and the tests can read the
 * rules. The reads and the fire are in lib/goals/handover-store.ts.
 */
import { isStepBlocked } from '@/lib/goals/dependencies';
import { runIsQuiet } from '@/lib/goals/shaping';
import { STEP_KIND_LABELS, STEP_STATUS_LABELS, type StepNode } from '@/lib/goals/steps';
import type { GoalStatus } from '@/lib/goals/tree';

export type SendJob = 'step' | 'phase' | 'prepare';

/** Send hands Claude's own work over; prepare asks Claude to ready one of yours. */
export type SendMode = 'send' | 'prepare';

/** What a send reads about the goal the step sits under. */
export type SendGoal = {
  id: string;
  title: string;
  acceptance: string | null;
  status: GoalStatus;
  approvedAt: string | null;
};

/** A step, where it sits, and the goal it is under. */
export type SendTarget = {
  goal: SendGoal;
  step: StepNode;
  /** The steps above it, from the goal's top level down to its parent. */
  above: StepNode[];
  /** The steps beside it under the same parent, itself included, in order. */
  siblings: StepNode[];
};

/** A started goals.runs row that might already cover the target. */
export type LiveRun = { itemId: string | null; job: string; createdAt: string; lastSeenAt?: string | null };

/** The sub-steps that make a step a phase. A question beneath does not. */
function substeps(step: StepNode): StepNode[] {
  return step.children.filter((child) => child.kind !== 'decision');
}

/**
 * Which run a step would get, or null when it is not Claude's to take. A step
 * with sub-steps is a phase, whoever's it is: the run works the Claude steps
 * in it. A Claude step with none is a step. A step of yours with none is not
 * sent here; preparing one is its own job (prepareJob, plan #1001).
 */
export function sendJob(step: Pick<StepNode, 'kind' | 'children'>): SendJob | null {
  if (step.kind === 'decision') return null;
  if (step.children.some((child) => child.kind !== 'decision')) return 'phase';
  return step.kind === 'claude' ? 'step' : null;
}

/** Whether the row offers Send at all. What is refused once pressed is sendRefusal's. */
export function offersSend(step: StepNode): boolean {
  return sendJob(step) !== null && step.status !== 'done' && step.status !== 'dropped';
}

/**
 * Whether Claude can prepare a step (plan #1001): one of yours with no
 * sub-steps, such as calling the servicer or sending an application. A rhythm
 * is yours too, but it repeats, so there is no one thing to prepare.
 */
export function prepareJob(step: Pick<StepNode, 'kind' | 'children'>): 'prepare' | null {
  if (step.kind !== 'mine') return null;
  return step.children.some((child) => child.kind !== 'decision') ? null : 'prepare';
}

/** Whether the row offers Prepare. What is refused once pressed is sendRefusal's. */
export function offersPrepare(step: StepNode): boolean {
  return prepareJob(step) !== null && step.status !== 'done' && step.status !== 'dropped';
}

/**
 * Which hand-over an @dash comment asking Claude to take a step starts
 * (plan #1003): a step of yours is prepared and stays yours, and anything
 * else is sent. A step that fits neither is refused by sendRefusal as a send.
 */
export function commentMode(step: Pick<StepNode, 'kind' | 'children'>): SendMode {
  return prepareJob(step) ? 'prepare' : 'send';
}

/** The job a send or a prepare would start on a step, or null when it has none. */
export function jobFor(step: Pick<StepNode, 'kind' | 'children'>, mode: SendMode): SendJob | null {
  return mode === 'prepare' ? prepareJob(step) : sendJob(step);
}

const isOpen = (node: StepNode) => node.status === 'open' || node.status === 'blocked';

/** Every id at or under a step. */
function idsUnder(step: StepNode, into: Set<string> = new Set()): Set<string> {
  into.add(step.id);
  for (const child of step.children) idsUnder(child, into);
  return into;
}

/**
 * Why a send is refused, as the sentence the row shows, or null when it may
 * go. In the order the person would want to hear them: a question is theirs
 * to answer; an unapproved goal and a proposal are waiting on their yes; a
 * closed or blocked step has nothing for Claude to do; and a step Claude is
 * already on takes one run, not two. `mode` is `prepare` for Prepare on a
 * step of yours (plan #1001), which may go ahead of the steps it waits on.
 */
export function sendRefusal(
  target: SendTarget,
  running: readonly LiveRun[],
  now: number,
  mode: SendMode = 'send',
): string | null {
  const { goal, step, above } = target;

  if (step.kind === 'decision') {
    return 'That is a question for you to answer, so there is nothing to send.';
  }
  if (goal.status === 'proposed' || goal.approvedAt === null) {
    return 'This goal is not approved yet. Approve it, then send its steps.';
  }
  if (goal.status !== 'open') {
    return `This goal is ${goal.status === 'done' ? 'done' : 'dropped'}, so nothing on it is sent.`;
  }
  const proposal = [...above, step].find((node) => node.status === 'proposed');
  if (proposal) {
    return proposal === step
      ? 'That step is still a proposal. Approve it, then send it.'
      : `That step sits under "${proposal.title}", which is still a proposal. Approve it first.`;
  }
  if (step.status === 'done' || step.status === 'dropped') {
    return `That step is ${STEP_STATUS_LABELS[step.status].toLowerCase()} already.`;
  }

  const job = jobFor(step, mode);
  if (!job) {
    return mode === 'prepare'
      ? 'Only a step of yours with no sub-steps can be prepared.'
      : 'That step is yours. Only Claude\'s steps, and phases with steps in them, can be sent.';
  }
  if (isStepBlocked(step)) {
    return step.blockAsk ? `That step is blocked: ${step.blockAsk}` : 'That step is blocked.';
  }
  const heldAbove = above.find((node) => isStepBlocked(node));
  if (heldAbove) return `That step sits under "${heldAbove.title}", which is blocked.`;
  if (job === 'step') {
    const waiting = step.waitingOn ?? [];
    if (waiting.length > 0) {
      return `That step waits on "${waiting[0].title}" first.`;
    }
  } else if (job === 'phase' && !substeps(step).some(isOpen)) {
    return 'Nothing under that phase is open, so there is nothing to send.';
  }

  const live = running.filter((run) => !runIsQuiet(run, now));
  const under = idsUnder(step);
  for (const run of live) {
    if (!run.itemId) continue;
    if (run.itemId === step.id) {
      return job === 'prepare'
        ? 'Claude is already preparing this step. What it writes will show here when it is done.'
        : `Claude is already working on this ${job}. What it produces will show here when it is done.`;
    }
    if (run.itemId === goal.id && (run.job === 'goal' || run.job === 'reshape')) {
      return 'Claude is already working on the whole goal. Send this once that run has finished.';
    }
    const phase = above.find((node) => node.id === run.itemId);
    if (phase) return `Claude is already working on "${phase.title}", which this is part of.`;
    if (under.has(run.itemId)) {
      return 'Claude is already working on a step in this phase. Send it once that run has finished.';
    }
  }
  return null;
}

/** A collection the goal fills, as the brief lists it. */
export type SendCollection = { id: string; name: string; fields: string[] };

function describe(node: StepNode): string {
  return `${STEP_KIND_LABELS[node.kind]}, ${STEP_STATUS_LABELS[node.status].toLowerCase()}`;
}

/** The subtree of a phase, one line a step, indented by depth. */
function treeLines(nodes: readonly StepNode[], depth: number): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}- "${node.title}" (${describe(node)}; id ${node.id})` +
      (node.acceptance ? ` Done when: ${node.acceptance}` : ''),
    ...treeLines(node.children, depth + 1),
  ]);
}

/**
 * The turn appended to the goals routine's standing prompt for one step or
 * one phase. It names the step first, then the goal it serves, where it sits,
 * the steps around it, and the collections the goal fills, so the session
 * starts from the part it was sent and reads outwards only as far as it needs.
 */
export function sendRunText(input: {
  target: SendTarget;
  job: SendJob;
  collections: readonly SendCollection[];
  userId: string;
  runId: string;
  /** The @dash comment that asked for it (plan #1003), when it came from the thread. */
  asked?: string;
}): string {
  const { target, job, collections } = input;
  const from = input.asked ? 'a comment on its row' : 'its row on the goal page';
  const { goal, step, above, siblings } = target;
  const noun = job === 'phase' ? 'phase' : 'step';

  const about = [
    `The ${noun}: "${step.title}" (goals.items id ${step.id}), ${describe(step)}.`,
    step.acceptance ? `Done when: ${step.acceptance}` : 'It has no done-when; read it from the title and the goal.',
    ...(step.detail ? [`Detail: ${step.detail}`] : []),
    ...((step.waitingOn ?? []).length > 0
      ? [`It waits on: ${(step.waitingOn ?? []).map((ref) => `"${ref.title}"`).join(', ')}.`]
      : []),
  ];

  const where = above.length > 0 ? above.map((node) => `"${node.title}"`).join(' > ') : 'the top level';

  const around = siblings.map(
    (node) =>
      `- "${node.title}" (${describe(node)}; id ${node.id})${node.id === step.id ? '  <- this one' : ''}`,
  );

  const forms =
    collections.length === 0
      ? ['None.']
      : collections.map(
          (c) => `- "${c.name}" (goals.collections id ${c.id}): ${c.fields.join(', ') || 'no fields yet'}`,
        );

  const work =
    job === 'phase'
      ? [
          'Work the open Claude steps in this phase, in order, as in the section "The morning',
          'run": produce what each asks for, store it on the step and close it. Leave the',
          "person's own steps and questions as they are. Stop at a step that needs something",
          'only the person has, and say so in the summary.',
        ]
      : job === 'prepare'
      ? [
          "This step is the person's own: they will do it, not you. Prepare it for them, as in",
          'the section "A step of yours to prepare": write what they need to do it, such as a',
          'draft email, a call script or a step-by-step checklist, made specific with what the',
          "goal's steps, collections and their email say (names, account numbers, phone numbers,",
          "sites). Store it in the step's result (and result_url when it lives somewhere with a",
          'link). Leave its kind, status and everything else as they are, and touch no other step.',
        ]
      : [
          'Work this one step, as in the section "The morning run": produce what its title',
          'and done-when ask for, store it in the step\'s result (and result_url when it lives',
          'somewhere with a link), and close the step as done. Touch no other step.',
        ];

  return [
    job === 'prepare'
      ? `Prepare one of the person's own steps on a goal, asked for from ${from}.`
      : `Work on one ${noun} of a goal, sent from ${from}.`,
    '',
    ...about,
    ...(input.asked
      ? [
          '',
          'What they wrote, which may say what to produce or how:',
          input.asked,
        ]
      : []),
    '',
    `The goal: "${goal.title}" (goals.items id ${goal.id}).`,
    goal.acceptance ? `The goal is done when: ${goal.acceptance}` : 'The goal has no done-when yet.',
    `Where the ${noun} sits: ${where}.`,
    '',
    `The steps beside it:`,
    ...around,
    ...(job === 'phase' ? ['', 'The steps in the phase:', ...treeLines(step.children, 0)] : []),
    '',
    "The goal's collections (forms its information steps fill):",
    ...forms,
    '',
    'Follow .claude/skills/goals/SKILL.md, the section "A step or phase sent from its row".',
    ...work,
    '',
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it on every write, and close that row',
    'with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}

/**
 * Find a step in a goal's tree, with the steps above it and beside it. Null
 * when it is not under this goal.
 */
export function locateStep(
  goal: SendGoal,
  steps: readonly StepNode[],
  stepId: string,
): SendTarget | null {
  const walk = (nodes: readonly StepNode[], above: StepNode[]): SendTarget | null => {
    for (const node of nodes) {
      if (node.id === stepId) return { goal, step: node, above, siblings: [...nodes] };
      const found = walk(node.children, [...above, node]);
      if (found) return found;
    }
    return null;
  };
  return walk(steps, []);
}
