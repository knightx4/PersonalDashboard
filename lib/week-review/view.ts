import { parseEventRef } from '@/lib/timeline/observations';
import { eventRef, type TimelineEvent } from '@/lib/timeline/timeline';
import { formatMoney } from '@/lib/money';
import { addDays } from '@/lib/todo/tasks/model';
import { wallClockToInstant } from '@/lib/todo/time';
import { localDay, WEEK_REVIEW_ZONE, type WeekFact, type WeekFacts } from './facts';
import { REVIEW_HOUR, type ReviewObservation } from './review';

/**
 * The Week page's rules (plan #1233): a stored core.week_reviews row turned
 * into what the page shows. Pure, so the reads in ./view-load.ts and the
 * tests share them. Each observation carries both weeks' figures of the facts
 * it cites and the goal it bears on; the change for next week comes last,
 * with a line on whether the previous week's change happened.
 */

/** The columns the page reads from core.week_reviews. */
export const WEEK_REVIEW_COLUMNS = 'week, facts, observations, change, change_kept, source, created_at';

/** One row of core.week_reviews, as the page reads it. */
export type WeekReviewRecord = {
  week: string;
  facts: WeekFacts;
  observations: ReviewObservation[];
  change: string | null;
  change_kept: boolean | null;
  source: 'model' | 'plain';
  created_at: string;
};

/** One figure beside an observation: this week's and last week's, written out. */
export type ShownFigure = {
  id: string;
  label: string;
  value: string;
  previous: string;
};

export type ShownWeekObservation = {
  text: string;
  goal: { id: string; title: string } | null;
  figures: ShownFigure[];
  /** The rows behind it that are on the timeline, newest first. */
  events: TimelineEvent[];
};

export type ShownWeekReview = {
  week: string;
  source: 'model' | 'plain';
  writtenAt: string;
  observations: ShownWeekObservation[];
  change: string | null;
  /** Whether the previous week's change happened, as one sentence; null when there was none to judge. */
  lastChange: string | null;
};

/** The Sunday a URL names, or null when it is not a date or not a Sunday. */
export function parseWeek(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const at = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== raw) return null;
  return at.getUTCDay() === 0 ? raw : null;
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "20 to 26 September 2026", for the week starting on a Sunday. */
export function weekRangeLabel(week: string): string {
  const saturday = addDays(week, 6);
  const start = new Date(`${week}T00:00:00Z`);
  const end = new Date(`${saturday}T00:00:00Z`);
  const first =
    start.getUTCFullYear() !== end.getUTCFullYear()
      ? DAY_MONTH_YEAR.format(start)
      : start.getUTCMonth() !== end.getUTCMonth()
        ? DAY_MONTH.format(start)
        : String(start.getUTCDate());
  return `${first} to ${DAY_MONTH_YEAR.format(end)}`;
}

/** "Week of 20 September", short enough for a link. */
export function weekShortLabel(week: string): string {
  return `Week of ${DAY_MONTH.format(new Date(`${week}T00:00:00Z`))}`;
}

/** A day and time in the reader's zone: "Sunday 4 October, 09:00". */
export function whenLabel(iso: string, timezone: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }).format(at);
  return `${day}, ${time}`;
}

/**
 * When the next review is written: the Sunday, as YYYY-MM-DD, on which Dash
 * writes it from 9am New York time; today when it is Sunday before nine. On
 * a Sunday after nine the run is due and may simply not have reached this
 * person yet, which `due` says.
 */
export function nextReviewDay(now: Date, timezone: string = WEEK_REVIEW_ZONE): { day: string; due: boolean } {
  const today = localDay(now, timezone);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday === 0) {
    const nine = Date.parse(wallClockToInstant(today, REVIEW_HOUR, timezone));
    return { day: today, due: now.getTime() >= nine };
  }
  return { day: addDays(today, 7 - weekday), due: false };
}

/** "Sunday 4 October", for a calendar day. */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** A fact's figure as the page writes it: a count, or an amount in its currency. */
export function figureText(fact: Pick<WeekFact, 'currency'>, value: number): string {
  return fact.currency ? formatMoney(value, fact.currency) : String(value);
}

/** Every timeline ref the observations cite, grouped by table, so each read is one `in (…)`. */
export function reviewEvidenceByTable(observations: readonly ReviewObservation[]): Map<string, string[]> {
  const byTable = new Map<string, Set<string>>();
  for (const observation of observations) {
    for (const ref of observation.evidence ?? []) {
      const parsed = parseEventRef(ref);
      if (!parsed) continue;
      const ids = byTable.get(parsed.sourceTable) ?? new Set<string>();
      ids.add(parsed.sourceId);
      byTable.set(parsed.sourceTable, ids);
    }
  }
  return new Map([...byTable].map(([table, ids]) => [table, [...ids]]));
}

/**
 * Whether last week's change happened, from last week's change and this
 * week's verdict on it. Null when last week set no change.
 */
export function lastChangeLine(previousChange: string | null, kept: boolean | null): string | null {
  const change = previousChange?.trim();
  if (!change) return null;
  const quoted = `“${change.replace(/[.\s]+$/, '')}”`;
  if (kept === true) return `Last week’s change happened: ${quoted}.`;
  if (kept === false) return `Last week’s change did not happen: ${quoted}.`;
  return `Dash could not tell whether last week’s change happened: ${quoted}.`;
}

/** The stored row as the page shows it, with the rows behind each observation found among `events`. */
export function showWeekReview(
  record: WeekReviewRecord,
  previousChange: string | null,
  events: readonly TimelineEvent[],
): ShownWeekReview {
  const facts = new Map((record.facts?.facts ?? []).map((fact) => [fact.id, fact]));
  const goals = new Map<string, string>();
  for (const goal of record.facts?.goals ?? []) goals.set(goal.id, goal.title);
  for (const stalled of record.facts?.stalled ?? []) if (!goals.has(stalled.goalId)) goals.set(stalled.goalId, stalled.title);
  const byRef = new Map(events.map((event) => [eventRef(event), event]));

  const observations = (record.observations ?? []).map((observation) => {
    const figures = (observation.facts ?? [])
      .map((id) => facts.get(id))
      .filter((fact): fact is WeekFact => fact !== undefined)
      .map((fact) => ({
        id: fact.id,
        label: fact.label,
        value: figureText(fact, fact.value),
        previous: figureText(fact, fact.previous),
      }));
    const title = observation.goal_id ? goals.get(observation.goal_id) : undefined;
    return {
      text: observation.text,
      goal: observation.goal_id && title ? { id: observation.goal_id, title } : null,
      figures,
      events: [...new Set(observation.evidence ?? [])]
        .map((ref) => byRef.get(ref))
        .filter((event): event is TimelineEvent => event !== undefined)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    };
  });

  return {
    week: record.week,
    source: record.source,
    writtenAt: record.created_at,
    observations,
    change: record.change?.trim() || null,
    lastChange: lastChangeLine(previousChange, record.change_kept),
  };
}
