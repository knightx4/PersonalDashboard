import { cleanSentence } from '@/lib/timeline/observations';
import { numbersIn } from '@/lib/timeline/year-review';
import { wallClockToInstant } from '@/lib/todo/time';
import { localDay, weekJustGone, WEEK_REVIEW_ZONE, type WeekFact, type WeekFacts } from './facts';

/**
 * The weekly review's words (plan #1232): what Dash is given, the checks
 * what it writes has to pass, and the plain version stored when it cannot
 * write. Pure, like ./facts.ts; the model call is ./model.ts and the run is
 * ./run.ts.
 *
 * The app counts and Dash chooses and words. Every number an observation
 * states must be this week's or last week's figure of a fact it cites, so a
 * figure on the Week page can always be traced to the rows behind it.
 */

/** The most observations a review keeps. A quiet week may have fewer. */
export const MAX_REVIEW_OBSERVATIONS = 5;

/** The fewest the model is asked for when the week has that much to say. */
export const MIN_REVIEW_OBSERVATIONS = 3;

/** The longest change for next week, as core.week_reviews allows. */
export const MAX_CHANGE_LENGTH = 600;

/** The hour on Sunday, New York time, from which the review is written. */
export const REVIEW_HOUR = '09:00';

/** The most rows one stored observation points at. */
const MAX_EVIDENCE = 200;

/**
 * The week a run at `now` writes, or null when it is not yet time: only on
 * Sunday from 9am in the review's zone. The Sunday call comes at 14:11 UTC
 * (supabase/migrations/0154_week_review_once.sql), which is past 9am in New
 * York on both sides of a clock change.
 */
export function reviewWeekDue(now: Date, timezone: string = WEEK_REVIEW_ZONE): string | null {
  const today = localDay(now, timezone);
  if (new Date(`${today}T00:00:00Z`).getUTCDay() !== 0) return null;
  if (now.getTime() < Date.parse(wallClockToInstant(today, REVIEW_HOUR, timezone))) return null;
  return weekJustGone(now, timezone);
}

/** One observation as stored in core.week_reviews.observations. */
export type ReviewObservation = {
  text: string;
  /** The goals.items goal it is tied to, or null. */
  goal_id: string | null;
  /** The rows behind it, as `schema.table:id`. */
  evidence: string[];
  /** The facts it cites, by WeekFact id, so the page can show both weeks' figures. */
  facts: string[];
};

/** What a review stores besides its facts. */
export type ReviewText = {
  observations: ReviewObservation[];
  change: string | null;
  change_kept: boolean | null;
};

/** Last week's stored review, as much of it as the new one reads. */
export type PreviousReview = {
  change: string | null;
  observations: string[];
};

/** One observation as the model gives it, before any check. */
export type RawReviewObservation = { text?: unknown; facts?: unknown; goal?: unknown };

/** The model's reply, before any check. */
export type RawReview = {
  observations?: unknown;
  change?: unknown;
  last_change?: unknown;
};

// What the model is given --------------------------------------------------------

function amount(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

/** A fact's figure as the prompt and the plain version write it. */
export function figure(fact: Pick<WeekFact, 'currency'>, value: number): string {
  return fact.currency ? `${amount(value)} ${fact.currency}` : String(value);
}

/** The short label each goal is given in the prompt (G1, G2, …), and the goal it stands for. */
export function goalLabels(facts: WeekFacts): Map<string, string> {
  const labels = new Map<string, string>();
  facts.goals.forEach((goal, index) => labels.set(`G${index + 1}`, goal.id));
  return labels;
}

/**
 * The user turn: the goals with short labels, the facts with both weeks'
 * figures and the goals each bears on, the stalled goals, last week's review
 * and what the home already said this week.
 */
export function reviewPrompt(facts: WeekFacts, previous: PreviousReview | null, homeSaid: readonly string[]): string {
  const labels = goalLabels(facts);
  const labelOf = new Map([...labels].map(([label, id]) => [id, label]));
  const goalList = (ids: readonly string[]) => {
    const named = ids.map((id) => labelOf.get(id)).filter((label): label is string => Boolean(label));
    return named.length > 0 ? named.join(', ') : 'none';
  };

  const lines = [
    `The week from Sunday ${facts.week}, ${facts.timezone} time.`,
    '',
    'Goals:',
    ...(facts.goals.length > 0 ? facts.goals.map((goal) => `${labelOf.get(goal.id)} | ${goal.title}`) : ['(none open)']),
    '',
    'Facts (id | what it counts | this week | last week | goals it bears on):',
    ...facts.facts.map(
      (fact) =>
        `${fact.id} | ${fact.label} | ${figure(fact, fact.value)} | ${figure(fact, fact.previous)} | ${goalList(fact.goalIds)}`,
    ),
    '',
    'Stalled goals, by their latest review:',
    ...(facts.stalled.length > 0
      ? facts.stalled.map(
          (goal) =>
            `${labelOf.get(goal.goalId) ?? '?'} | ${goal.title} | ${goal.reason.replace(/\s+/g, ' ').trim()}${
              goal.stalledLastWeek ? ' | stalled last week too' : ''
            }`,
        )
      : ['(none)']),
    '',
    'Last week\'s review:',
    ...(previous
      ? [
          ...(previous.observations.length > 0 ? previous.observations.map((text) => `- ${text}`) : ['(no observations)']),
          `Change it set for this week: ${previous.change ?? '(none)'}`,
        ]
      : ['(there was none)']),
    '',
    'Already said on the home page this week:',
    ...(homeSaid.length > 0 ? homeSaid.map((text) => `- ${text}`) : ['(nothing)']),
  ];
  return lines.join('\n');
}

// Checking what comes back ----------------------------------------------------------

/** Why an observation was left out; for the run's summary and the tests. */
export type ReviewDropReason = 'no-text' | 'label-in-text' | 'no-number' | 'unknown-fact' | 'number-not-in-facts' | 'over-limit';

/** A fact id or a goal label written into the text, where it means nothing to the person. */
const LABEL_IN_TEXT = /\bG\d+\b|\b(?:jobs|events|shopping|money|learn|vault|todo|goals)\.[a-z]+/;

function addFigure(numbers: Set<string>, fact: WeekFact, value: number) {
  if (!fact.currency) {
    numbers.add(String(value));
    return;
  }
  numbers.add(amount(value));
  if (Math.abs(value) % 100 === 0) numbers.add(String(Math.abs(value) / 100));
}

/** The numbers a text citing these facts may state: both weeks' figures of each. */
export function allowedNumbers(cited: readonly WeekFact[], titles: readonly string[]): Set<string> {
  const numbers = new Set<string>();
  for (const fact of cited) {
    addFigure(numbers, fact, fact.value);
    addFigure(numbers, fact, fact.previous);
  }
  // A goal named by its title may carry a number of its own: "Run a 10k".
  for (const title of titles) for (const number of numbersIn(title)) numbers.add(number);
  return numbers;
}

function onlyAllowed(text: string, allowed: Set<string>): boolean {
  return numbersIn(text).every((number) => allowed.has(number));
}

/** Text as stored: one line, trimmed, no spaced dashes, ending in a full stop. */
function clean(text: unknown, max: number): string | null {
  if (typeof text !== 'string') return null;
  const line = cleanSentence(text);
  if (!line || line.length > max) return null;
  return line;
}

/**
 * Keep what the model wrote that can be stored, or null when nothing can be
 * and the plain version should stand in. An observation is dropped when it
 * has no text, writes a fact id or goal label into the text, states no
 * number, cites a fact it was not given, or states a number that is not a
 * figure of a fact it cites. The review is usable only with at least one
 * observation and a change whose numbers are all in the facts.
 *
 * change_kept is taken from the model only when last week's review set a
 * change; it is Dash's reading of this week's facts against that change,
 * and null when it could not tell.
 */
export function checkReview(
  raw: RawReview | null,
  facts: WeekFacts,
  previous: PreviousReview | null,
): { review: ReviewText | null; dropped: ReviewDropReason[] } {
  const dropped: ReviewDropReason[] = [];
  if (!raw) return { review: null, dropped };

  const byId = new Map(facts.facts.map((fact) => [fact.id, fact]));
  const labels = goalLabels(facts);
  const titleOf = new Map(facts.goals.map((goal) => [goal.id, goal.title]));
  const titles = facts.goals.map((goal) => goal.title);

  const observations: ReviewObservation[] = [];
  for (const item of Array.isArray(raw.observations) ? (raw.observations as RawReviewObservation[]) : []) {
    const text = clean(item?.text, 400);
    if (!text) {
      dropped.push('no-text');
      continue;
    }
    if (LABEL_IN_TEXT.test(text)) {
      dropped.push('label-in-text');
      continue;
    }
    if (!/\d/.test(text)) {
      dropped.push('no-number');
      continue;
    }
    const ids = Array.isArray(item.facts) ? item.facts : [];
    const cited = ids.map((id) => (typeof id === 'string' ? byId.get(id.trim()) : undefined));
    if (cited.length === 0 || cited.some((fact) => !fact)) {
      dropped.push('unknown-fact');
      continue;
    }
    const citedFacts = [...new Map(cited.map((fact) => [fact!.id, fact!])).values()];
    const goalId = typeof item.goal === 'string' ? (labels.get(item.goal.trim()) ?? null) : null;
    if (!onlyAllowed(text, allowedNumbers(citedFacts, titles))) {
      dropped.push('number-not-in-facts');
      continue;
    }
    if (observations.length >= MAX_REVIEW_OBSERVATIONS) {
      dropped.push('over-limit');
      continue;
    }
    observations.push({
      text,
      goal_id: goalId && titleOf.has(goalId) ? goalId : null,
      evidence: [...new Set(citedFacts.flatMap((fact) => fact.evidence))].slice(0, MAX_EVIDENCE),
      facts: citedFacts.map((fact) => fact.id),
    });
  }

  const change = clean(raw.change, MAX_CHANGE_LENGTH);
  const changeOk =
    change !== null && !LABEL_IN_TEXT.test(change) && onlyAllowed(change, allowedNumbers(facts.facts, titles));
  if (observations.length === 0 || !changeOk) return { review: null, dropped };

  const said = typeof raw.last_change === 'string' ? raw.last_change.trim().toLowerCase() : '';
  const change_kept = previous?.change ? (said === 'kept' ? true : said === 'not_kept' ? false : null) : null;
  return { review: { observations, change, change_kept }, dropped };
}

// The plain version -------------------------------------------------------------------

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plain(fact: WeekFact, value: number): string {
  return fact.currency ? amount(value) : String(value);
}

/** Whether a week and the one before hold nothing at all to write about. */
export function isQuietWeek(facts: WeekFacts): boolean {
  return facts.stalled.length === 0 && facts.facts.every((fact) => fact.value === 0 && fact.previous === 0);
}

/**
 * The review the app writes itself when Dash cannot: the facts that moved
 * most against last week, each as one sentence with both figures, and, when
 * a goal is stalled, taking one step on it as the change. Counts come before
 * money when both moved, and a quiet week gets no observations at all.
 */
export function plainReview(facts: WeekFacts): ReviewText {
  const moved = facts.facts
    .filter((fact) => fact.id !== 'goals.stalled' && (fact.value !== 0 || fact.previous !== 0))
    .map((fact, index) => ({ fact, index, changed: fact.value !== fact.previous }))
    .sort((a, b) => Number(b.changed) - Number(a.changed) || a.index - b.index)
    .slice(0, MAX_REVIEW_OBSERVATIONS)
    .sort((a, b) => a.index - b.index)
    .map(({ fact }) => fact);

  const observations: ReviewObservation[] = moved.map((fact) => ({
    // The label names the currency ("spent in USD"), so the figures do not repeat it.
    text: `${capitalise(fact.label)}: ${plain(fact, fact.value)} this week, against ${plain(fact, fact.previous)} the week before.`,
    goal_id: fact.goalIds[0] ?? null,
    evidence: fact.evidence.slice(0, MAX_EVIDENCE),
    facts: [fact.id],
  }));

  const stalled = facts.stalled[0];
  const change = stalled?.title
    ? `Take one step on ${stalled.title}, which its latest review marks as stalled.`.slice(0, MAX_CHANGE_LENGTH)
    : null;
  return { observations, change, change_kept: null };
}
