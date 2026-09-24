/**
 * Whose move each step is, and how far through a goal is (docs/GOALS-SPEC.md,
 * "Taken from the dev plan", item 3; plan #958).
 *
 * The same idea as `healthOf` and `moveOf` in lib/plan/tree.ts, cut to what a
 * goal has. A step's health is what state it is in, drawn as the plan's
 * hexagon for the same state; its move is which of three words it carries:
 * On you, With Claude or Waiting. The words, shapes and tones are the plan's
 * own, so a question looks the same on /goals as on /dev/plan.
 *
 * Goals have no dependencies between steps. What a step waits on is the open
 * steps under it, which is the rule the daily view already uses to pick what
 * is next (lib/goals/daily.ts): a step with open sub-steps is not itself next,
 * they are.
 *
 * Pure, so the rules are tested without a database or a page.
 */
import type { DevTone } from '@/components/dev/state-label';
import { DEV_STATE_WORD } from '@/lib/dev/words';
import { awaitsReview } from '@/lib/goals/daily';
import { awaitsAnswer } from '@/lib/goals/shaping';
import type { StepNode } from '@/lib/goals/steps';
import { PLAN_HEALTH_GLYPHS, type StatusGlyph } from '@/lib/status-glyphs';

/**
 * What state a step is in.
 *
 * - `proposed`: Claude wrote it and you have not approved it.
 * - `unanswered`: a question waiting on your answer.
 * - `review`: a Claude step with a result you have not read.
 * - `yours`: an open step of yours (or a rhythm) with nothing open under it.
 * - `working`: an open Claude step with nothing produced yet.
 * - `waiting`: an open step with open steps under it.
 * - `aside`: a question put aside with Not now.
 * - `done`, `answered`, `dropped`: closed.
 */
export const STEP_HEALTHS = [
  'proposed',
  'unanswered',
  'review',
  'yours',
  'working',
  'waiting',
  'aside',
  'done',
  'answered',
  'dropped',
] as const;
export type StepHealth = (typeof STEP_HEALTHS)[number];

/** Whose move it is. `settled` is a closed step, which has none. */
export type StepMove = 'on_you' | 'with_claude' | 'waiting' | 'settled';

/** The three words, and what a closed step says instead. */
export const STEP_MOVE_WORD: Record<StepMove, string> = {
  on_you: 'On you',
  with_claude: 'With Claude',
  waiting: 'Waiting',
  settled: '',
};

/**
 * The plan's three colours (note 42aa1fa4): anything that cannot move until
 * you do, or until the steps under it do, is amber; what Claude is on is
 * blue. A closed step takes its health's tone instead.
 */
export const STEP_MOVE_TONE: Record<StepMove, DevTone> = {
  on_you: 'caution',
  with_claude: 'info',
  waiting: 'caution',
  settled: 'ghost',
};

const MOVE_OF: Record<StepHealth, StepMove> = {
  proposed: 'on_you',
  unanswered: 'on_you',
  review: 'on_you',
  yours: 'on_you',
  working: 'with_claude',
  waiting: 'waiting',
  aside: 'waiting',
  done: 'settled',
  answered: 'settled',
  dropped: 'settled',
};

/**
 * The plan's hexagon for the nearest plan state. A step of yours with nothing
 * under it is ready in the plan's sense and draws half full; a Claude step is
 * being worked and draws three quarters; a result to read is stopped on you,
 * which is the plan's bar.
 */
export const STEP_HEALTH_GLYPHS: Record<StepHealth, StatusGlyph> = {
  proposed: PLAN_HEALTH_GLYPHS.proposed,
  unanswered: PLAN_HEALTH_GLYPHS.unanswered,
  review: PLAN_HEALTH_GLYPHS.blocked,
  yours: PLAN_HEALTH_GLYPHS.ready,
  working: PLAN_HEALTH_GLYPHS.working,
  waiting: PLAN_HEALTH_GLYPHS.waiting,
  aside: PLAN_HEALTH_GLYPHS.unanswered,
  done: PLAN_HEALTH_GLYPHS.done,
  answered: PLAN_HEALTH_GLYPHS.answered,
  dropped: PLAN_HEALTH_GLYPHS.dropped,
};

/** Why a step says what it says, for the tooltip. */
const HEALTH_TITLE: Record<StepHealth, string> = {
  proposed: 'Claude proposed this step. Nothing happens to it until you approve it.',
  unanswered: 'A question waiting on your answer.',
  review: 'Claude has finished this. Read what it produced and mark it read.',
  yours: 'Yours to do.',
  working: 'Claude does this one. The morning run works it and leaves the result here.',
  waiting: 'Waits on the steps under it.',
  aside: 'Put aside with Not now. It waits until you come back to it.',
  done: 'Done.',
  answered: 'Answered.',
  dropped: 'Dropped.',
};

function isClosed(node: StepNode): boolean {
  return node.status === 'done' || node.status === 'dropped';
}

/** A question put aside with Not now and not answered since. */
function isAside(node: StepNode): boolean {
  return node.kind === 'decision' && node.resolution === null && Boolean(node.dismissedAt);
}

/** Whether a sub-step still holds its parent open. A put-aside question does not. */
function holdsOpen(node: StepNode): boolean {
  return node.status === 'open' && !isAside(node);
}

export function stepHealth(node: StepNode): StepHealth {
  // First, because a Claude step you marked done with its result unread is
  // still on you: the result is what the step was for.
  if (awaitsReview(node)) return 'review';
  if (node.status === 'dropped') return 'dropped';
  if (node.status === 'done') return node.kind === 'decision' ? 'answered' : 'done';
  if (node.status === 'proposed') return 'proposed';
  if (node.kind === 'decision') {
    if (awaitsAnswer(node)) return 'unanswered';
    if (isAside(node)) return 'aside';
  }
  if (node.children.some(holdsOpen)) return 'waiting';
  return node.kind === 'claude' ? 'working' : 'yours';
}

export function stepMove(node: StepNode): StepMove {
  return MOVE_OF[stepHealth(node)];
}

/** Every step beneath these, at any depth. */
function flatten(nodes: readonly StepNode[]): StepNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** How many of each move a list of steps holds. */
function countMoves(nodes: readonly StepNode[]): Record<StepMove, number> {
  const counts: Record<StepMove, number> = { on_you: 0, with_claude: 0, waiting: 0, settled: 0 };
  for (const node of nodes) counts[stepMove(node)] += 1;
  return counts;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "2 on you, 1 with Claude". Empty when nothing is open. */
function movesLine(counts: Record<StepMove, number>): string {
  return [
    counts.on_you > 0 ? `${counts.on_you} on you` : null,
    counts.with_claude > 0 ? `${counts.with_claude} with Claude` : null,
    counts.waiting > 0 ? `${counts.waiting} waiting` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** What a step row shows beside its title. */
export type StepState = {
  health: StepHealth;
  move: StepMove;
  glyph: StatusGlyph;
  /** On you, With Claude, Waiting; Done, Answered or Dropped once closed. */
  word: string;
  tone: DevTone;
  title: string;
};

export function stepState(node: StepNode): StepState {
  const health = stepHealth(node);
  const move = MOVE_OF[health];
  const closedWord: Partial<Record<StepHealth, string>> = {
    done: DEV_STATE_WORD.done,
    answered: 'Answered',
    dropped: DEV_STATE_WORD.dropped,
  };
  const closedTone: Partial<Record<StepHealth, DevTone>> = {
    done: 'positive',
    answered: 'positive',
    dropped: 'ghost',
  };

  let title = HEALTH_TITLE[health];
  // The tooltips that can only be written with the step in hand, as on the
  // plan: what a waiting step waits on, and what an answer said.
  if (health === 'waiting') {
    const open = node.children.filter(holdsOpen);
    const beneath = movesLine(countMoves(flatten(open).filter((step) => !isClosed(step))));
    title = `Waits on the ${plural(open.length, 'open step', 'open steps')} under it${beneath ? `: ${beneath}` : ''}.`;
  } else if (health === 'answered' && node.resolution) {
    title = `Answered: ${node.resolution}`;
  } else if (health === 'yours' && node.kind === 'rhythm') {
    title = 'Yours to keep up.';
  }

  return {
    health,
    move,
    glyph: STEP_HEALTH_GLYPHS[health],
    word: STEP_MOVE_WORD[move] || closedWord[health] || '',
    tone: move === 'settled' ? (closedTone[health] ?? 'ghost') : STEP_MOVE_TONE[move],
    title,
  };
}

/** Questions waiting on your answer beneath a step, not counting the step itself. */
export function questionsBeneath(node: StepNode): number {
  return flatten(node.children).filter(awaitsAnswer).length;
}

/** How many open sub-steps the Needs line names before counting the rest. */
const NEEDS_NAMED = 3;

/**
 * What a step is held up by, in one line, for the Needs block of an opened
 * step (plan #959). A goal step has no block of its own, so this is what the
 * plan's Needs line would say: the open steps under it, named, or your
 * approval on a proposal. Null when nothing holds it up, which includes a
 * question waiting on you, since its answer box already says so.
 */
export function stepNeeds(node: StepNode): string | null {
  const health = stepHealth(node);
  if (health === 'proposed') return 'Your approval. Nothing happens to it until then.';
  if (health !== 'waiting') return null;
  const open = node.children.filter(holdsOpen);
  const named = open.slice(0, NEEDS_NAMED).map((step) => {
    const move = stepMove(step);
    return move === 'settled' ? step.title : `${step.title} (${PROGRESS_BAND_WORD[move]})`;
  });
  const rest = open.length - named.length;
  if (rest > 0) named.push(plural(rest, 'more', 'more'));
  return `${named.join(', ')} to close first.`;
}

/** The bands a goal's bar is drawn in, left to right, as the plan orders them. */
export const PROGRESS_BANDS = ['on_you', 'waiting', 'with_claude', 'done'] as const;
export type ProgressBand = (typeof PROGRESS_BANDS)[number];

export const PROGRESS_BAND_WORD: Record<ProgressBand, string> = {
  on_you: 'on you',
  waiting: 'waiting',
  with_claude: 'with Claude',
  done: 'done',
};

export const PROGRESS_BAND_FILL: Record<ProgressBand, string> = {
  on_you: 'bg-caution',
  waiting: 'bg-caution',
  with_claude: 'bg-status-submitted',
  done: 'bg-positive',
};

/** A goal at a glance: whose move it is, and how far through it is. */
export type GoalProgress = {
  /** Steps counted in the bar. */
  live: number;
  done: number;
  bands: Record<ProgressBand, number>;
  /** The goal's move, reported from its steps: the most pressing one there is. */
  move: StepMove;
  /** Every open step by move, for the tooltip. */
  moves: Record<StepMove, number>;
  /** Questions waiting on your answer anywhere in the goal. */
  questions: number;
};

/**
 * How far through a goal is, over its steps.
 *
 * Counted over the steps that are the work: a step with counted steps under
 * it is a container, and counting it as well would say "twelve things" about
 * seven. Proposed and dropped steps are left out, as the plan leaves them out
 * of its bar: a proposal is not agreed work, and a dropped step is not work at
 * all. So is a question put aside, which is out of view until you ask for it.
 */
export function goalProgress(nodes: readonly StepNode[]): GoalProgress {
  const bands: Record<ProgressBand, number> = { on_you: 0, waiting: 0, with_claude: 0, done: 0 };
  const counts = (node: StepNode) =>
    node.status !== 'proposed' && node.status !== 'dropped' && !isAside(node);

  // Returns whether anything at or under `node` was counted.
  const walk = (node: StepNode): boolean => {
    let under = false;
    for (const child of node.children) under = walk(child) || under;
    if (under || !counts(node)) return under;
    const move = stepMove(node);
    if (move === 'settled') bands.done += 1;
    else bands[move] += 1;
    return true;
  };
  for (const node of nodes) walk(node);

  const all = flatten(nodes);
  const moves = countMoves(all);
  const move =
    (['on_you', 'with_claude', 'waiting'] as const).find((name) => moves[name] > 0) ?? 'settled';
  const live = PROGRESS_BANDS.reduce((sum, band) => sum + bands[band], 0);
  return {
    live,
    done: bands.done,
    bands,
    move,
    moves,
    questions: all.filter(awaitsAnswer).length,
  };
}

/** The goal's word and its tooltip, for the line above its steps. */
export function goalMoveLabel(progress: GoalProgress): { word: string; tone: DevTone; title: string } {
  const line = movesLine(progress.moves);
  const titles: Record<StepMove, string> = {
    on_you: 'Something here is waiting on you',
    with_claude: 'Claude has the next move here',
    waiting: 'Every open step here waits on the steps under it',
    settled: 'Nothing open on this goal',
  };
  return {
    word: STEP_MOVE_WORD[progress.move],
    tone: STEP_MOVE_TONE[progress.move],
    title: line ? `${titles[progress.move]}. Open steps: ${line}.` : `${titles[progress.move]}.`,
  };
}

/** "3 of 8 done". */
export function progressWords(progress: GoalProgress): string {
  return `${progress.done} of ${plural(progress.live, 'step', 'steps')} done`;
}
