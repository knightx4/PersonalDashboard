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
 * Pure, so the row can ask whether to offer Send and the tests can read the
 * rules. The reads and the fire are in lib/goals/handover-store.ts.
 */
import { isStepBlocked } from '@/lib/goals/dependencies';
import { RUN_QUIET_MS } from '@/lib/goals/shaping';
import { STEP_KIND_LABELS, STEP_STATUS_LABELS, type StepNode } from '@/lib/goals/steps';
import type { GoalStatus } from '@/lib/goals/tree';

export type SendJob = 'step' | 'phase';

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
export type LiveRun = { itemId: string | null; job: string; createdAt: string };

/** The sub-steps that make a step a phase. A question beneath does not. */
function substeps(step: StepNode): StepNode[] {
  return step.children.filter((child) => child.kind !== 'decision');
}

/**
 * Which run a step would get, or null when it is not Claude's to take. A step
 * with sub-steps is a phase, whoever's it is: the run works the Claude steps
 * in it. A Claude step with none is a step. A step of yours with none is not
 * sent here; preparing one is its own job (plan #1001).
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
 * already on takes one run, not two.
 */
export function sendRefusal(target: SendTarget, running: readonly LiveRun[], now: number): string | null {
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

  const job = sendJob(step);
  if (!job) {
    return 'That step is yours. Only Claude\'s steps, and phases with steps in them, can be sent.';
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
  } else if (!substeps(step).some(isOpen)) {
    return 'Nothing under that phase is open, so there is nothing to send.';
  }

  const live = running.filter((run) => now - Date.parse(run.createdAt) < RUN_QUIET_MS);
  const under = idsUnder(step);
  for (const run of live) {
    if (!run.itemId) continue;
    if (run.itemId === step.id) {
      return `Claude is already working on this ${job}. What it produces will show here when it is done.`;
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
}): string {
  const { target, job, collections } = input;
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
      : [
          'Work this one step, as in the section "The morning run": produce what its title',
          'and done-when ask for, store it in the step\'s result (and result_url when it lives',
          'somewhere with a link), and close the step as done. Touch no other step.',
        ];

  return [
    `Work on one ${noun} of a goal, sent from its row on the goal page.`,
    '',
    ...about,
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
