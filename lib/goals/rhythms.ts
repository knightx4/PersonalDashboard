/**
 * Rhythms, period by period (docs/GOALS-SPEC.md, "Rhythms"; plan #928).
 *
 * A rhythm step has a target count per day, week or month. Each period it has
 * run is a row in goals.periods holding the target it had then, the count it
 * reached and whether it was kept. The rows are stored rather than worked out
 * again later, so last March's result does not change when the target does.
 *
 * Nothing runs on a clock to open and close periods. Whenever a page or Todo
 * reads the rhythms, syncPlan works out what the rows should be by today and
 * the store writes the difference: periods that have ended are closed as kept
 * or missed, periods nobody opened the app in are written as missed, and the
 * current one is opened. Running it twice writes nothing the second time.
 *
 * A period runs from `startsOn` up to but not including `endsOn`, so a day's
 * period ends the next day. Weeks start on Monday, as the Todo calendar's do.
 *
 * Pure, so the dates and the rules are tested without a database. The reads
 * and writes are in lib/goals/rhythms-store.ts.
 */
import type { RhythmPeriod, StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';
import { startOfWeek } from '@/lib/todo/calendar/range';
import { addDays } from '@/lib/todo/tasks/model';

export type PeriodSpan = { startsOn: string; endsOn: string };

export type PeriodRow = PeriodSpan & {
  id: string;
  itemId: string;
  target: number;
  count: number;
  /** Null while the period is open. */
  kept: boolean | null;
  closedAt: string | null;
};

/** A rhythm step that is live: open, under open steps, in an open goal. */
export type LiveRhythm = {
  id: string;
  title: string;
  target: number;
  period: RhythmPeriod;
  goalId: string;
  goalTitle: string;
};

/**
 * The most missed periods written in one go for a rhythm nobody looked at.
 * Enough for a year of weeks; a daily rhythm left for longer keeps only its
 * most recent two months.
 */
export const MAX_BACKFILL = 60;

/** How many closed periods a rhythm shows behind the current one. */
export const PAST_SHOWN = 8;

/** The period of this kind holding `day`. */
export function periodOf(period: RhythmPeriod, day: string): PeriodSpan {
  if (period === 'day') return { startsOn: day, endsOn: addDays(day, 1) };
  if (period === 'week') {
    const monday = startOfWeek(day);
    return { startsOn: monday, endsOn: addDays(monday, 7) };
  }
  const first = `${day.slice(0, 8)}01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { startsOn: first, endsOn: next.toISOString().slice(0, 10) };
}

/**
 * The live rhythms in these goal trees: the same reach as Todo's steps, so a
 * rhythm under a dropped branch or a goal you have not taken on yet is left
 * alone, and its last period stays as it was until it is live again.
 */
export function liveRhythms(goals: Goal[], byGoal: Map<string, StepNode[]>): LiveRhythm[] {
  const out: LiveRhythm[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open') continue;
        if (node.kind === 'rhythm' && node.rhythmCount && node.rhythmPeriod) {
          out.push({
            id: node.id,
            title: node.title,
            target: node.rhythmCount,
            period: node.rhythmPeriod,
            goalId: goal.id,
            goalTitle: goal.title,
          });
        }
        walk(node.children);
      }
    };
    walk(byGoal.get(goal.id) ?? []);
  }
  return out;
}

export type SyncPlan = {
  /** Open periods to close. kept is whether the count reached the target. */
  close: { id: string; kept: boolean }[];
  /**
   * The current period's target and end, when the rhythm's own have changed
   * since it was opened.
   */
  reshape: { id: string; target: number; endsOn: string }[];
  /** New rows: missed periods (closed, count 0) and the current one (open). */
  insert: (PeriodSpan & { itemId: string; target: number; kept: boolean | null })[];
};

/**
 * What has to be written so each live rhythm has its periods up to today.
 *
 * `rows` is every stored period of these rhythms, in any order. An open row
 * that has ended is closed on its count. An open row covering today whose
 * dates no longer match the rhythm's period (a weekly rhythm made monthly) is
 * closed on its count too, and the right one opened, except where both start
 * on the same day: then the one row is kept and given the new end, since the
 * table holds one period per rhythm per start day. The current period also
 * takes the rhythm's target when that has changed.
 */
export function syncPlan(rhythms: LiveRhythm[], rows: PeriodRow[], today: string): SyncPlan {
  const plan: SyncPlan = { close: [], reshape: [], insert: [] };
  const byItem = new Map<string, PeriodRow[]>();
  for (const row of rows) {
    const list = byItem.get(row.itemId) ?? [];
    list.push(row);
    byItem.set(row.itemId, list);
  }

  for (const rhythm of rhythms) {
    const current = periodOf(rhythm.period, today);
    const own = (byItem.get(rhythm.id) ?? []).sort((a, b) =>
      a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0,
    );

    let hasCurrent = false;
    for (const row of own) {
      if (row.closedAt !== null) {
        if (row.startsOn === current.startsOn) hasCurrent = true;
        continue;
      }
      if (row.startsOn === current.startsOn) {
        hasCurrent = true;
        if (row.target !== rhythm.target || row.endsOn !== current.endsOn) {
          plan.reshape.push({ id: row.id, target: rhythm.target, endsOn: current.endsOn });
        }
        continue;
      }
      plan.close.push({ id: row.id, kept: row.count >= row.target });
    }
    if (hasCurrent) continue;

    // Periods between the last row and today that nobody opened: missed.
    const last = own.at(-1);
    const missed: PeriodSpan[] = [];
    if (last && last.endsOn < current.startsOn) {
      let span = periodOf(rhythm.period, last.endsOn);
      if (span.startsOn < last.endsOn) span = periodOf(rhythm.period, span.endsOn);
      while (span.startsOn < current.startsOn) {
        missed.push(span);
        span = periodOf(rhythm.period, span.endsOn);
      }
    }
    for (const span of missed.slice(-MAX_BACKFILL)) {
      plan.insert.push({ ...span, itemId: rhythm.id, target: rhythm.target, kept: false });
    }
    plan.insert.push({ ...current, itemId: rhythm.id, target: rhythm.target, kept: null });
  }
  return plan;
}

/** Days left in a period, today included. */
export function daysLeft(span: PeriodSpan, today: string): number {
  const ms = Date.parse(`${span.endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Days of room a period is given before it counts as at risk. A weekly
 * rhythm of one is at risk from Friday, with three days left.
 */
const SLACK: Record<RhythmPeriod, number> = { day: 0, week: 2, month: 7 };

/**
 * Whether the current period is unmet and running out: fewer days left than
 * the count still needed, plus some room. A daily rhythm is at risk all of
 * any day it is not yet met.
 */
export function isAtRisk(
  period: RhythmPeriod,
  row: Pick<PeriodRow, 'startsOn' | 'endsOn' | 'target' | 'count'>,
  today: string,
): boolean {
  const needed = row.target - row.count;
  if (needed <= 0) return false;
  return daysLeft(row, today) <= needed + SLACK[period];
}

/** "this week", "today", "this month". */
export function periodLabel(period: RhythmPeriod): string {
  return period === 'day' ? 'today' : `this ${period}`;
}

/** "1 of 3 this week". */
export function progressLine(period: RhythmPeriod, row: Pick<PeriodRow, 'target' | 'count'>) {
  return `${row.count} of ${row.target} ${periodLabel(period)}`;
}

/** A rhythm's current period and the closed ones before it, oldest first. */
export type RhythmRecord = { current: PeriodRow | null; past: PeriodRow[] };

/** Group stored rows into a record per rhythm, keeping the last PAST_SHOWN. */
export function recordsOf(rows: PeriodRow[], today: string): Map<string, RhythmRecord> {
  const out = new Map<string, RhythmRecord>();
  const sorted = [...rows].sort((a, b) =>
    a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0,
  );
  for (const row of sorted) {
    const record = out.get(row.itemId) ?? { current: null, past: [] };
    if (row.closedAt === null && row.startsOn <= today && today < row.endsOn) {
      record.current = row;
    } else if (row.closedAt !== null) {
      record.past.push(row);
    }
    out.set(row.itemId, record);
  }
  for (const record of out.values()) record.past = record.past.slice(-PAST_SHOWN);
  return out;
}

export type AtRiskRhythm = LiveRhythm & { count: number; daysLeft: number };

/** The live rhythms at risk this period, in the order they came. */
export function atRiskRhythms(
  rhythms: LiveRhythm[],
  records: Map<string, RhythmRecord>,
  today: string,
): AtRiskRhythm[] {
  const out: AtRiskRhythm[] = [];
  for (const rhythm of rhythms) {
    const current = records.get(rhythm.id)?.current;
    if (!current || !isAtRisk(rhythm.period, current, today)) continue;
    out.push({ ...rhythm, count: current.count, daysLeft: daysLeft(current, today) });
  }
  return out;
}
