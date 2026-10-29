import type { RunQuestion } from '@/lib/core/run-questions';
import type { DashLaneItem } from './lanes';
import type { TodayItem, TodayKind } from './today';
import { toGoalActivity } from './tree';

/**
 * Everything on you in Goals, sorted for the Inbox tab by what finishes each
 * row: something to go and do, a question to answer, or a proposal to say
 * yes or no to. The same three groups as the Inbox in Dev, so the two read
 * the same way.
 *
 * Every goal's rows are here, not only the ones with a due date: the Home's Do
 * next is the short list for today, and this is all of it.
 *
 * Rows that say one thing many times are folded into one (October 2026, when
 * 41 of the Inbox's 63 rows were questions from Dash, 31 of them on one goal):
 * two or more questions on a goal are one row for that goal, and two or more
 * goals offered for parking are one row. Each folded row opens to the rows
 * it holds, and counts as one in the badge.
 */

export type GoalInboxKey = 'actions' | 'questions' | 'review';

/** Several rows that say one thing, drawn as one row that opens to them. */
export type InboxBundle = {
  /** Unique on the page: `questions:<goal id>` or `park`. */
  key: string;
  kind: 'questions' | 'park';
  title: string;
  /** One line under the title. */
  detail: string;
  /** The goal they are all on, for a bundle of questions; null for parking. */
  goalId: string | null;
  goalTitle: string | null;
  items: TodayItem[];
};

export type GoalInboxGroup = {
  key: GoalInboxKey;
  title: string;
  /** What finishes a row in it, under its count in the overview. */
  hint: string;
  /** The rows drawn on their own, in the ranking they were handed. */
  items: TodayItem[];
  /** The folded rows, ahead of the single ones. */
  bundles: InboxBundle[];
  /** Dash's steps that stopped on a question for you; only Questions holds any. */
  dash: DashLaneItem[];
  /** Runs stopped partway on a question for you (plan #1824); only Questions holds any. */
  runs: RunQuestion[];
};

const GROUP_OF: Record<TodayKind, GoalInboxKey> = {
  step: 'actions',
  rhythm: 'actions',
  finished: 'actions',
  question: 'questions',
  ask: 'questions',
  flag: 'questions',
  went: 'questions',
  breakdown: 'review',
  plan: 'review',
  close: 'review',
  park: 'review',
  suggestion: 'review',
};

const TITLE: Record<GoalInboxKey, [string, string]> = {
  actions: ['Your actions', 'To go and do'],
  questions: ['Questions for you', 'Need your answer'],
  review: ['To review', 'Need your yes'],
};

/**
 * What is on you and what Dash is stuck on, less every row from a passive
 * goal (plan #2503). A passive goal asks for nothing, so none of its steps,
 * rhythms, questions, flags, proposals or did-you-go rows reach the Inbox,
 * its badge or Do next; its dated events come up only as mentions on the
 * home. A step of one you sent to Todo yourself stays on Todo
 * (lib/goals/todo.ts), and the goal's page still lists everything.
 */
export function withoutPassiveGoals(
  goals: readonly { goal: { id: string; activity?: unknown } }[],
  onYou: readonly TodayItem[],
  dash: readonly DashLaneItem[],
): { onYou: TodayItem[]; dash: DashLaneItem[] } {
  const passive = new Set(
    goals.filter(({ goal }) => toGoalActivity(goal.activity) === 'passive').map(({ goal }) => goal.id),
  );
  return {
    onYou: onYou.filter((item) => !passive.has(item.goalId)),
    // Dash's own steps on a passive goal stay in its lane; one stuck on a
    // question for you does not, since the question would be asking.
    dash: dash.filter((item) => !(item.needs && passive.has(item.goalId))),
  };
}

/**
 * The rows to fold: each goal's questions when it has two or more, and the
 * park proposals when there are two or more. What is not folded comes back
 * in `single`, in the order it was given.
 */
export function bundleRows(items: readonly TodayItem[]): {
  bundles: InboxBundle[];
  single: TodayItem[];
} {
  const questionsByGoal = new Map<string, TodayItem[]>();
  for (const item of items) {
    if (item.kind !== 'question') continue;
    questionsByGoal.set(item.goalId, [...(questionsByGoal.get(item.goalId) ?? []), item]);
  }
  const parks = items.filter((item) => item.kind === 'park');
  const folded = new Set<TodayItem>();
  const bundles: InboxBundle[] = [];
  for (const [goalId, questions] of questionsByGoal) {
    if (questions.length < 2) continue;
    questions.forEach((q) => folded.add(q));
    const more = questions.length - 1;
    bundles.push({
      key: `questions:${goalId}`,
      kind: 'questions',
      title: `${questions.length} questions from Dash on ${questions[0].goalTitle}`,
      detail: `${questions[0].title} and ${more} more`,
      goalId,
      goalTitle: questions[0].goalTitle,
      items: questions,
    });
  }
  if (parks.length >= 2) {
    parks.forEach((p) => folded.add(p));
    bundles.push({
      key: 'park',
      kind: 'park',
      title: `${parks.length} goals have had nothing done in three weeks`,
      detail: parks.map((p) => p.goalTitle).join(', '),
      goalId: null,
      goalTitle: null,
      items: parks,
    });
  }
  return { bundles, single: items.filter((item) => !folded.has(item)) };
}

/**
 * The three groups, in order, each keeping the ranking it was handed, with
 * its repeated rows folded (bundleRows). All three come back whether or not
 * they hold anything; the page leaves an empty one out.
 */
export function goalInboxGroups(
  onYou: readonly TodayItem[],
  dash: readonly DashLaneItem[],
  runs: readonly RunQuestion[] = [],
): GoalInboxGroup[] {
  return (['actions', 'questions', 'review'] as const).map((key) => {
    const { bundles, single } = bundleRows(onYou.filter((item) => GROUP_OF[item.kind] === key));
    return {
      key,
      title: TITLE[key][0],
      hint: TITLE[key][1],
      items: single,
      bundles,
      dash: key === 'questions' ? dash.filter((item) => item.needs) : [],
      runs: key === 'questions' ? [...runs] : [],
    };
  });
}

/**
 * How many rows the Inbox holds, for the tab's badge and Home's link: a
 * folded row counts once.
 */
export function goalInboxCount(
  onYou: readonly TodayItem[],
  dash: readonly DashLaneItem[],
  runs: readonly RunQuestion[] = [],
): number {
  const { bundles, single } = bundleRows(onYou);
  return single.length + bundles.length + dash.filter((item) => item.needs).length + runs.length;
}
