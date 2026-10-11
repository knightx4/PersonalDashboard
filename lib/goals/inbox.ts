import type { DashLaneItem } from './lanes';
import type { TodayItem, TodayKind } from './today';

/**
 * Everything on you in Goals, sorted for the Inbox tab by what finishes each
 * row: something to go and do, a question to answer, or a proposal to say
 * yes or no to. The same three groups as the Inbox in Dev, so the two read
 * the same way.
 *
 * Every goal's rows are here, not only the week's focus goals: the Home's Do
 * next is the short list for today, and this is all of it.
 */

export type GoalInboxKey = 'actions' | 'questions' | 'review';

export type GoalInboxGroup = {
  key: GoalInboxKey;
  title: string;
  /** What finishes a row in it, under its count in the overview. */
  hint: string;
  items: TodayItem[];
  /** Dash's steps that stopped on a question for you; only Questions holds any. */
  dash: DashLaneItem[];
};

const GROUP_OF: Record<TodayKind, GoalInboxKey> = {
  step: 'actions',
  rhythm: 'actions',
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
 * The three groups, in order, each keeping the ranking it was handed. All
 * three come back whether or not they hold anything; the page leaves an empty
 * one out.
 */
export function goalInboxGroups(
  onYou: readonly TodayItem[],
  dash: readonly DashLaneItem[],
): GoalInboxGroup[] {
  return (['actions', 'questions', 'review'] as const).map((key) => ({
    key,
    title: TITLE[key][0],
    hint: TITLE[key][1],
    items: onYou.filter((item) => GROUP_OF[item.kind] === key),
    dash: key === 'questions' ? dash.filter((item) => item.needs) : [],
  }));
}

/** How many rows the Inbox holds, for the tab's badge and Home's link. */
export function goalInboxCount(onYou: readonly TodayItem[], dash: readonly DashLaneItem[]): number {
  return onYou.length + dash.filter((item) => item.needs).length;
}
