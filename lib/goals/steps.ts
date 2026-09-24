/**
 * The step tree under a goal (docs/GOALS-SPEC.md, "The three levels"; plan
 * #925).
 *
 * A goal holds steps, and a step holds sub-steps to any depth. Each step is
 * one of four kinds: yours, Claude's, a question for you, or a rhythm. A step
 * can also count towards goals other than its own, and each of those goals
 * shows it too.
 *
 * The rules that need no database live here: building the tree from flat
 * rows, what a valid step is, and what a step looks like at a glance. The
 * reads and writes are in lib/goals/steps-store.ts.
 */
import type { StatusGlyph } from '@/lib/status-glyphs';
import type { GoalStatus } from '@/lib/goals/tree';

/** The limits the table's checks set (supabase/migrations-goals/0001). */
export const STEP_TITLE_MAX = 500;
export const STEP_DETAIL_MAX = 20000;
export const STEP_ACCEPTANCE_MAX = 4000;
export const RHYTHM_COUNT_MAX = 100;

export const STEP_KINDS = ['mine', 'claude', 'decision', 'rhythm'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const RHYTHM_PERIODS = ['day', 'week', 'month'] as const;
export type RhythmPeriod = (typeof RHYTHM_PERIODS)[number];

/** What each kind is called on the page, and whose it is. */
export const STEP_KIND_LABELS: Record<StepKind, string> = {
  mine: 'Yours',
  claude: "Claude's",
  decision: 'Question for you',
  rhythm: 'Rhythm',
};

/**
 * One shape per status. A proposed step is dashed like a proposed plan step;
 * an open one is the empty hexagon; done is ticked and dropped is struck.
 */
export const STEP_STATUS_GLYPHS: Record<GoalStatus, StatusGlyph> = {
  proposed: 'dashed',
  open: 'empty',
  done: 'check',
  dropped: 'slash',
};

export const STEP_STATUS_LABELS: Record<GoalStatus, string> = {
  proposed: 'Proposed',
  open: 'Open',
  done: 'Done',
  dropped: 'Dropped',
};

export type Step = {
  id: string;
  parentId: string;
  kind: StepKind;
  status: GoalStatus;
  title: string;
  detail: string | null;
  /** The done-when. */
  acceptance: string | null;
  /** A question's answer, once there is one. */
  resolution: string | null;
  /** YYYY-MM-DD. */
  dueOn: string | null;
  position: number;
  rhythmCount: number | null;
  rhythmPeriod: RhythmPeriod | null;
};

export type StepNode = Step & { children: StepNode[] };

/** A step from another goal's tree that also counts towards this one. */
export type LinkedStep = {
  linkId: string;
  /** The goal the step sits under. */
  fromGoal: { id: string; title: string };
  step: StepNode;
};

/** Anything in the tree that can be a parent: a goal, or a step. */
export type TreeRow = { id: string; parentId: string | null };

/**
 * Each goal's steps as a tree, keyed by goal id.
 *
 * `rows` are live goals and live steps together, already in sibling order. A
 * step whose parent is not among them hangs under something archived, so it
 * is left out along with everything beneath it: archiving a step or a goal
 * takes its whole branch out of view without touching the rows under it.
 * Also returned is the goal each shown step belongs to, which is what a link
 * to a second goal needs to say where the step came from.
 */
export function buildForest(
  goalIds: string[],
  steps: Step[],
): { byGoal: Map<string, StepNode[]>; goalOf: Map<string, string>; nodes: Map<string, StepNode> } {
  const childrenOf = new Map<string, Step[]>();
  for (const step of steps) {
    const list = childrenOf.get(step.parentId) ?? [];
    list.push(step);
    childrenOf.set(step.parentId, list);
  }

  const goalOf = new Map<string, string>();
  const nodes = new Map<string, StepNode>();

  // Walked from each goal downwards, so only reachable steps are built, and a
  // cycle (which no write here can make) could not loop: a node seen once is
  // not visited again.
  function build(parentId: string, goalId: string): StepNode[] {
    return (childrenOf.get(parentId) ?? [])
      .filter((step) => !nodes.has(step.id))
      .map((step) => {
        const node: StepNode = { ...step, children: [] };
        nodes.set(step.id, node);
        goalOf.set(step.id, goalId);
        node.children = build(step.id, goalId);
        return node;
      });
  }

  const byGoal = new Map<string, StepNode[]>();
  for (const goalId of goalIds) byGoal.set(goalId, build(goalId, goalId));
  return { byGoal, goalOf, nodes };
}

/** How many steps a branch holds, and how many of them are closed. */
export function countSteps(nodes: StepNode[]): { total: number; closed: number } {
  let total = 0;
  let closed = 0;
  const walk = (list: StepNode[]) => {
    for (const node of list) {
      total += 1;
      if (node.status === 'done' || node.status === 'dropped') closed += 1;
      walk(node.children);
    }
  };
  walk(nodes);
  return { total, closed };
}

/** "Once a week", "3 a month". */
export function describeRhythm(count: number, period: RhythmPeriod): string {
  if (count === 1) return `Once a ${period}`;
  if (count === 2) return `Twice a ${period}`;
  return `${count} a ${period}`;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type StepFields = {
  title?: string;
  detail?: string | null;
  acceptance?: string | null;
  kind?: StepKind;
  due_on?: string | null;
  rhythm_count?: number | null;
  rhythm_period?: RhythmPeriod | null;
};

function clean(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

const present = (raw: unknown) => raw !== null && raw !== undefined;

/** A real calendar date in YYYY-MM-DD, which is what a date input sends. */
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The step fields present on a form, in the table's own column names so the
 * result can be written as it is. A field that is absent is left alone; a
 * detail, done-when or due date sent empty is cleared. The title cannot be
 * cleared.
 *
 * Kind and rhythm go together, because the table refuses one without the
 * other: choosing `rhythm` needs a count (the period defaults to a week), and
 * choosing any other kind clears the count and period.
 */
export function parseStepFields(
  get: (key: string) => unknown,
  { requireTitle = false }: { requireTitle?: boolean } = {},
): Parsed<StepFields> {
  const fields: StepFields = {};

  const rawTitle = get('title');
  if (present(rawTitle)) {
    const title = clean(rawTitle);
    if (!title) return { ok: false, error: 'Give the step a title.' };
    if (title.length > STEP_TITLE_MAX) {
      return { ok: false, error: `Keep the title under ${STEP_TITLE_MAX} characters.` };
    }
    fields.title = title;
  } else if (requireTitle) {
    return { ok: false, error: 'Give the step a title.' };
  }

  const rawDetail = get('detail');
  if (present(rawDetail)) {
    const detail = clean(rawDetail);
    if (detail && detail.length > STEP_DETAIL_MAX) {
      return { ok: false, error: `Keep the detail under ${STEP_DETAIL_MAX} characters.` };
    }
    fields.detail = detail;
  }

  const rawAcceptance = get('acceptance');
  if (present(rawAcceptance)) {
    const acceptance = clean(rawAcceptance);
    if (acceptance && acceptance.length > STEP_ACCEPTANCE_MAX) {
      return { ok: false, error: `Keep the done-when under ${STEP_ACCEPTANCE_MAX} characters.` };
    }
    fields.acceptance = acceptance;
  }

  const rawDue = get('dueOn');
  if (present(rawDue)) {
    const due = clean(rawDue);
    if (due && !isDate(due)) return { ok: false, error: 'That is not a date.' };
    fields.due_on = due;
  }

  const rawKind = get('kind');
  const rawCount = get('rhythmCount');
  const rawPeriod = get('rhythmPeriod');

  let count: number | undefined;
  if (present(rawCount)) {
    const text = clean(rawCount);
    const value = text === null ? NaN : Number(text);
    if (!Number.isInteger(value) || value < 1 || value > RHYTHM_COUNT_MAX) {
      return { ok: false, error: `Say how many times, from 1 to ${RHYTHM_COUNT_MAX}.` };
    }
    count = value;
  }

  let period: RhythmPeriod | undefined;
  if (present(rawPeriod)) {
    const text = clean(rawPeriod);
    if (!text || !(RHYTHM_PERIODS as readonly string[]).includes(text)) {
      return { ok: false, error: 'A rhythm is per day, week or month.' };
    }
    period = text as RhythmPeriod;
  }

  if (present(rawKind)) {
    const kind = clean(rawKind);
    if (!kind || !(STEP_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, error: 'Choose what kind of step it is.' };
    }
    fields.kind = kind as StepKind;
    if (kind === 'rhythm') {
      if (count === undefined) return { ok: false, error: 'Say how often the rhythm is.' };
      fields.rhythm_count = count;
      fields.rhythm_period = period ?? 'week';
    } else {
      fields.rhythm_count = null;
      fields.rhythm_period = null;
    }
  } else {
    // Changing how often without changing the kind; the table refuses it on
    // a step that is not a rhythm.
    if (count !== undefined) fields.rhythm_count = count;
    if (period !== undefined) fields.rhythm_period = period;
  }

  return { ok: true, value: fields };
}
