/**
 * Today on the Goals home: what is waiting on you, as one ranked list of at
 * most five, each with one action (plan #1075, under #1072).
 *
 * It draws from what the home already reads: questions, approvals, your
 * ready steps, rhythms behind for the period, flags, suggestions and "Did you
 * go?". A Claude step blocked on a question to you (its Needs line asks
 * something) is on you as well, since answering it is what frees the step.
 * Results to read are left out: they are what Dash did, which the home lists
 * separately (plan #1076).
 *
 * The order, first rule first:
 *
 * 1. How many steps doing it unblocks. A step or a question you close frees
 *    the steps that were waiting only on it. Answering a blocked Claude step
 *    frees that step. Approving a breakdown frees every step in it. The step
 *    above is not counted: a step with steps under it is a container, not
 *    work of its own, as goalProgress counts it.
 * 2. Its date, earliest first, with dated before undated. An overdue step
 *    counts as due today, and so does "Did you go?".
 * 3. A rhythm whose period is about to end, fewest days left first, then the
 *    one furthest short.
 * 4. The kind of thing it is (KIND_ORDER).
 * 5. The goal least far through, so a goal nothing has moved on is not left
 *    behind the busy ones.
 * 6. Page order, then tree order.
 *
 * A goal's plain steps (undated, unblocking nothing) are its backlog rather
 * than today's work, so only the first of them per goal is a candidate. The
 * rest stay on the goal page.
 *
 * Pure, so the ranking and the cap are tested without a database. The reads
 * are in lib/goals/today-store.ts.
 */
import { dailyView } from '@/lib/goals/daily';
import {
  isClosedStatus,
  isStaleStepBlock,
  isStepBlocked,
  waitsOnNothing,
} from '@/lib/goals/dependencies';
import type { HomeRhythm } from '@/lib/goals/rhythms';
import type { StepNode } from '@/lib/goals/steps';
import type { Suggestion } from '@/lib/goals/suggestions';
import type { Goal } from '@/lib/goals/tree';

/** The most things Today shows. The rest are on each goal's page. */
export const TODAY_CAP = 5;

export type TodayKind =
  | 'question'
  | 'ask'
  | 'flag'
  | 'went'
  | 'breakdown'
  | 'rhythm'
  | 'step'
  | 'suggestion'
  | 'plan';

export type TodayItem = {
  kind: TodayKind;
  /**
   * The row the action is on: the step for a question, an ask, a step or a
   * rhythm; the raised_items row for a flag; the suggestion for a suggestion
   * or "Did you go?"; the goal for a breakdown; the area for a plan.
   */
  id: string;
  /** What to do, as the line reads. */
  title: string;
  /** One line under it, when there is more to say. */
  detail: string | null;
  goalId: string;
  goalTitle: string;
  /** The label of its one button. */
  action: string;
  /** How many steps doing it unblocks. */
  unblocks: number;
  /** YYYY-MM-DD it is for, or null when undated. */
  on: string | null;
  /** For a rhythm: the current period's first day, which Log one counts against. */
  startsOn?: string;
  /** For a suggestion: the page it came from, when it has one. */
  url?: string;
};

/** The button each kind carries. */
export const TODAY_ACTIONS: Record<TodayKind, string> = {
  question: 'Answer',
  ask: 'Answer',
  flag: 'Answer',
  went: 'I went',
  breakdown: 'Review',
  rhythm: 'Log one',
  step: 'Done',
  suggestion: 'Going',
  plan: 'Review',
};

/**
 * Among things equal on the rules above it: a question holds up the tree
 * above it, a flag is something that already happened out in the world, and
 * "Did you go?" is about a day already gone. A step of yours finishes the
 * work when you do it, where answering a blocked Claude step only lets Dash
 * start on it, so the step comes first. A proposed goal holds up nothing
 * until you want it, so it comes last.
 */
const KIND_ORDER: Record<TodayKind, number> = {
  question: 0,
  flag: 1,
  went: 2,
  breakdown: 3,
  rhythm: 4,
  step: 5,
  ask: 6,
  suggestion: 7,
  plan: 8,
};

export type TodayInput = {
  /** Live goals in page order with their area's name, as loadLiveTree returns them. */
  goals: readonly { goal: Goal; areaName: string }[];
  /** Each goal's step tree, with dependencies attached and start dates marked. */
  byGoal: ReadonlyMap<string, StepNode[]>;
  /** YYYY-MM-DD in the account's zone. */
  today: string;
  /** The rhythms the home shows (homeRhythms): at risk this period, or behind. */
  rhythms: readonly HomeRhythm[];
  /** Open flags on goals, as rows with the goal's title (flagsWaiting). */
  flags: readonly { id: string; title: string; goalId: string; goalTitle: string }[];
  /** This fortnight's suggestions still to react to (homeSuggestions). */
  suggestions: readonly Suggestion[];
  /** The ones to ask "Did you go?" about (didYouGoSuggestions). */
  didYouGo: readonly Suggestion[];
};

type Candidate = TodayItem & {
  /** Where it came in, for the last tie-break. */
  order: number;
  /** How far through its goal is, 0 to 1. */
  through: number;
  /** For a rhythm: days left in the period, and how many short it still is. */
  daysLeft?: number;
  short?: number;
};

/** The ranked Today list, at most TODAY_CAP long. */
export function todayList(input: TodayInput): TodayItem[] {
  return todayRanked(input).slice(0, TODAY_CAP);
}

/**
 * Everything that could be on Today, ranked, without the cap. The home shows
 * the first TODAY_CAP and folds the rest under them, so nothing on you is
 * out of reach.
 */
export function todayRanked(input: TodayInput): TodayItem[] {
  return rankToday(todayCandidates(input));
}

/**
 * Whether a rhythm is behind for the period: it still needs at least as many
 * as there are days left, today included. A weekly rhythm of one gets there
 * on the last day of the week; five a week with none logged gets there five
 * days before the end.
 */
export function rhythmBehind(rhythm: Pick<HomeRhythm, 'target' | 'count' | 'daysLeft'>): boolean {
  const short = rhythm.target - rhythm.count;
  return short > 0 && short >= rhythm.daysLeft;
}

/**
 * The first sentence of a Needs line when it asks you something, or null when
 * it does not. "Which community board is yours? Tell me the neighborhood"
 * asks; "Your target title decided, and a pay floor set" names steps it waits
 * on and is not a question for you.
 */
export function askedOfYou(blockAsk: string | null | undefined): string | null {
  const ask = blockAsk?.trim();
  if (!ask) return null;
  const end = ask.indexOf('?');
  if (end < 0) return null;
  return ask.slice(0, end + 1).trim();
}

/** Every step in these trees by id. */
function index(byGoal: ReadonlyMap<string, StepNode[]>): Map<string, StepNode> {
  const nodes = new Map<string, StepNode>();
  const walk = (list: StepNode[]) => {
    for (const node of list) {
      nodes.set(node.id, node);
      walk(node.children);
    }
  };
  for (const roots of byGoal.values()) walk(roots);
  return nodes;
}

const isLive = (status: StepNode['status']) => status === 'open' || status === 'blocked';

/** How many steps closing `node` frees: those waiting on it and on nothing else still open. */
export function unblockedBy(node: StepNode, nodes: ReadonlyMap<string, StepNode>): number {
  let count = 0;
  for (const ref of node.blocks ?? []) {
    const waiting = nodes.get(ref.id);
    if (!waiting || !isLive(waiting.status)) continue;
    const others = (waiting.dependsOn ?? []).filter((link) => link.item.id !== node.id);
    if (others.every((link) => isClosedStatus(link.item.status))) count += 1;
  }
  return count;
}

/** Everything that could be on Today, unranked. */
export function todayCandidates(input: TodayInput): Candidate[] {
  const { goals, byGoal, today } = input;
  const nodes = index(byGoal);
  const out: Candidate[] = [];
  const through = new Map<string, number>();
  for (const { goal } of goals) through.set(goal.id, closedShare(byGoal.get(goal.id) ?? []));
  const add = (
    item: Omit<Candidate, 'order' | 'through' | 'action'>,
    extra: Partial<Candidate> = {},
  ) => {
    out.push({
      ...item,
      action: TODAY_ACTIONS[item.kind],
      order: out.length,
      through: through.get(item.goalId) ?? 0,
      ...extra,
    });
  };

  // Questions, breakdowns and proposed goals, read the way the home reads them.
  const daily = dailyView(goals as { goal: Goal; areaName: string }[], new Map(byGoal), today);
  const questions = new Set<string>();
  for (const item of daily.waiting) {
    if (item.kind === 'question') questions.add(item.id);
  }

  for (const { goal } of goals) {
    if (goal.status !== 'open') continue;
    let plainTaken = false;
    const walk = (list: StepNode[]) => {
      for (const node of list) {
        if (node.status === 'proposed' || node.waitsUntil) continue;
        const base = { id: node.id, goalId: goal.id, goalTitle: goal.title };
        if (questions.has(node.id)) {
          const unblocks = unblockedBy(node, nodes);
          add({ ...base, kind: 'question', title: node.title, detail: null, unblocks, on: null });
        } else if (node.kind === 'claude' && isStepBlocked(node) && node.blockKind === 'outside') {
          const question = askedOfYou(node.blockAsk);
          if (question) {
            const rest = node.blockAsk!.trim().slice(question.length).trim();
            add({
              ...base,
              kind: 'ask',
              title: question,
              detail: rest || null,
              unblocks: 1,
              on: null,
            });
          }
        } else if (
          node.kind === 'mine' &&
          (node.status === 'open' || isStaleStepBlock(node)) &&
          waitsOnNothing(node)
        ) {
          const unblocks = unblockedBy(node, nodes);
          const on = node.dueOn === null ? null : node.dueOn < today ? today : node.dueOn;
          const plain = unblocks === 0 && on === null;
          if (!plain || !plainTaken) {
            add({ ...base, kind: 'step', title: node.title, detail: null, unblocks, on });
            if (plain) plainTaken = true;
          }
        }
        if (node.status !== 'open' && !isStaleStepBlock(node)) continue;
        walk(node.children);
      }
    };
    walk(byGoal.get(goal.id) ?? []);
  }

  for (const item of daily.waiting) {
    if (item.kind === 'breakdown') {
      add({
        kind: 'breakdown',
        id: item.id,
        title: `Look over ${item.count === 1 ? 'the step' : `${item.count} steps`} proposed for ${item.goalTitle}`,
        detail: null,
        goalId: item.goalId,
        goalTitle: item.goalTitle,
        unblocks: item.count,
        on: null,
      });
    } else if (item.kind === 'plan') {
      add({
        kind: 'plan',
        id: item.id,
        title:
          item.count === 1
            ? `Look over the goal proposed in ${item.title}`
            : `Look over ${item.count} goals proposed in ${item.title}`,
        detail: item.count === 1 ? item.goalTitle : null,
        goalId: item.goalId,
        goalTitle: item.goalTitle,
        unblocks: 0,
        on: null,
      });
    }
  }

  for (const rhythm of input.rhythms) {
    if (!rhythmBehind(rhythm)) continue;
    const short = rhythm.target - rhythm.count;
    const period = rhythm.period === 'day' ? 'today' : `this ${rhythm.period}`;
    const left = rhythm.daysLeft === 1 ? 'last day' : `${rhythm.daysLeft} days left`;
    add(
      {
        kind: 'rhythm',
        id: rhythm.id,
        title: rhythm.title,
        detail: `${rhythm.count} of ${rhythm.target} ${period}, ${left}`,
        goalId: rhythm.goalId,
        goalTitle: rhythm.goalTitle,
        unblocks: 0,
        on: null,
        startsOn: rhythm.startsOn,
      },
      { daysLeft: rhythm.daysLeft, short },
    );
  }

  for (const flag of input.flags) {
    add({
      kind: 'flag',
      id: flag.id,
      title: flag.title,
      detail: null,
      goalId: flag.goalId,
      goalTitle: flag.goalTitle,
      unblocks: 0,
      on: null,
    });
  }

  const goalTitles = new Map(goals.map(({ goal }) => [goal.id, goal.title]));
  const goalOf = (s: Suggestion): { goalId: string; goalTitle: string } | null => {
    if (!s.itemId) return null;
    const direct = goalTitles.get(s.itemId);
    if (direct !== undefined) return { goalId: s.itemId, goalTitle: direct };
    // A suggestion made for a rhythm step names the step; find its goal.
    for (const [goalId, roots] of byGoal) {
      if (contains(roots, s.itemId)) return { goalId, goalTitle: goalTitles.get(goalId) ?? '' };
    }
    return null;
  };
  for (const s of input.didYouGo) {
    const owner = goalOf(s);
    if (!owner) continue;
    add({
      kind: 'went',
      id: s.id,
      title: `Did you go to ${s.title}?`,
      detail: null,
      ...owner,
      unblocks: 0,
      on: today,
    });
  }
  for (const s of input.suggestions) {
    if (s.reaction === 'going') continue; // already said yes; it is on Todo on its day
    const owner = goalOf(s);
    if (!owner) continue;
    add({
      kind: 'suggestion',
      id: s.id,
      title: s.title,
      detail: s.place,
      ...owner,
      unblocks: 0,
      on: s.happensOn,
      ...(s.url ? { url: s.url } : {}),
    });
  }

  return out;
}

/**
 * How far through a goal is: the share of its steps that are closed, counted
 * over the steps that are the work (a step with counted steps under it is a
 * container). Unlike goalProgress, a Claude result you have not read counts
 * as done here, since the work in it is finished.
 */
export function closedShare(roots: readonly StepNode[]): number {
  let live = 0;
  let done = 0;
  const counts = (node: StepNode) => node.status !== 'proposed' && node.status !== 'dropped';
  const walk = (node: StepNode): boolean => {
    let under = false;
    for (const child of node.children) under = walk(child) || under;
    if (under || !counts(node)) return under;
    live += 1;
    if (node.status === 'done') done += 1;
    return true;
  };
  for (const node of roots) walk(node);
  return live > 0 ? done / live : 0;
}

function contains(list: readonly StepNode[], id: string): boolean {
  return list.some((node) => node.id === id || contains(node.children, id));
}

/** Candidates in Today's order (the rules at the top of this file). */
export function rankToday(candidates: readonly Candidate[]): TodayItem[] {
  return [...candidates]
    .sort(
      (a, b) =>
        b.unblocks - a.unblocks ||
        compareOn(a.on, b.on) ||
        compareRhythm(a, b) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.through - b.through ||
        a.order - b.order,
    )
    .map((c) => ({
      kind: c.kind,
      id: c.id,
      title: c.title,
      detail: c.detail,
      goalId: c.goalId,
      goalTitle: c.goalTitle,
      action: c.action,
      unblocks: c.unblocks,
      on: c.on,
      ...(c.startsOn ? { startsOn: c.startsOn } : {}),
      ...(c.url ? { url: c.url } : {}),
    }));
}

function compareOn(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** A rhythm before anything else undated, fewest days left then furthest short. */
function compareRhythm(a: Candidate, b: Candidate): number {
  const ar = a.kind === 'rhythm';
  const br = b.kind === 'rhythm';
  if (ar !== br) return ar ? -1 : 1;
  if (!ar) return 0;
  return (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || (b.short ?? 0) - (a.short ?? 0);
}
