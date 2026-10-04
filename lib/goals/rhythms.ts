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
 * A rhythm that counts itself (lib/goals/rhythm-sources.ts) takes its count
 * from its source in the same pass: the store reads the source over the
 * periods the plan touches, and syncPlan writes that count onto them, closing
 * ended periods on it. The period just closed is read again too, so an
 * application entered a day late still counts towards last week until this
 * week ends.
 *
 * A period runs from `startsOn` up to but not including `endsOn`, so a day's
 * period ends the next day. Weeks start on Monday, as the Todo calendar's do.
 *
 * Pure, so the dates and the rules are tested without a database. The reads
 * and writes are in lib/goals/rhythms-store.ts.
 */
import { rhythmSource, sourceSuffix, type CountSource, type RhythmSource } from '@/lib/goals/rhythm-sources';
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
  /** Where its count is read from; null or absent when it is counted by hand. */
  source?: RhythmSource | null;
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
        // A practice for later counts no periods, and misses none, until it starts.
        if (node.waitsUntil) continue;
        if (node.kind === 'rhythm' && node.rhythmCount && node.rhythmPeriod) {
          out.push({
            id: node.id,
            title: node.title,
            target: node.rhythmCount,
            period: node.rhythmPeriod,
            goalId: goal.id,
            goalTitle: goal.title,
            source: rhythmSource(node.countSource, node.countMatch),
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
  /**
   * Open periods to close. kept is whether the count reached the target;
   * count is set when a source gave the period a new one.
   */
  close: { id: string; kept: boolean; count?: number }[];
  /**
   * The current period's target and end, when the rhythm's own have changed
   * since it was opened.
   */
  reshape: { id: string; target: number; endsOn: string }[];
  /**
   * Stored periods whose count a source now reads differently: the open one,
   * and the one just closed, whose kept is worked out again (null for an
   * open period).
   */
  recount: { id: string; count: number; kept: boolean | null }[];
  /** New rows: missed periods (closed) and the current one (open), with the count a source gave them. */
  insert: (PeriodSpan & { itemId: string; target: number; count: number; kept: boolean | null })[];
};

/** The key of one rhythm's period in the counts a source gave. */
export const countKey = (itemId: string, startsOn: string) => `${itemId}:${startsOn}`;

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
 *
 * `counts` holds what a rhythm's source counted for some of its periods,
 * keyed by countKey. A period with a count there takes it: an open row is
 * recounted, an ended one closed on it, a closed one recounted with its kept
 * worked out again, and a new row inserted with it. A missed period that
 * gets a count is inserted as kept when the count reaches the target.
 */
export function syncPlan(
  rhythms: LiveRhythm[],
  rows: PeriodRow[],
  today: string,
  counts: ReadonlyMap<string, number> = new Map(),
): SyncPlan {
  const plan: SyncPlan = { close: [], reshape: [], recount: [], insert: [] };
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
    const counted = (startsOn: string) => counts.get(countKey(rhythm.id, startsOn));

    let hasCurrent = false;
    for (const row of own) {
      const fresh = counted(row.startsOn);
      if (row.closedAt !== null) {
        if (row.startsOn === current.startsOn) hasCurrent = true;
        if (fresh !== undefined && fresh !== row.count) {
          plan.recount.push({ id: row.id, count: fresh, kept: fresh >= row.target });
        }
        continue;
      }
      if (row.startsOn === current.startsOn) {
        hasCurrent = true;
        if (row.target !== rhythm.target || row.endsOn !== current.endsOn) {
          plan.reshape.push({ id: row.id, target: rhythm.target, endsOn: current.endsOn });
        }
        if (fresh !== undefined && fresh !== row.count) {
          plan.recount.push({ id: row.id, count: fresh, kept: null });
        }
        continue;
      }
      if (fresh !== undefined && fresh !== row.count) {
        plan.close.push({ id: row.id, kept: fresh >= row.target, count: fresh });
      } else {
        plan.close.push({ id: row.id, kept: row.count >= row.target });
      }
    }
    if (hasCurrent) continue;

    // Periods between the last row and today that nobody opened: missed,
    // unless a source counted enough in one.
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
      const count = counted(span.startsOn) ?? 0;
      plan.insert.push({
        ...span,
        itemId: rhythm.id,
        target: rhythm.target,
        count,
        kept: count >= rhythm.target,
      });
    }
    plan.insert.push({
      ...current,
      itemId: rhythm.id,
      target: rhythm.target,
      count: counted(current.startsOn) ?? 0,
      kept: null,
    });
  }
  return plan;
}

/**
 * The periods a sourced rhythm's count is read for, by rhythm id: every
 * period `plan` (made without counts) opens, keeps open or closes, and the
 * closed period just before the current one, so a late entry still counts
 * there. A rhythm counted by hand has none.
 */
export function sourcedSpans(
  rhythms: LiveRhythm[],
  rows: PeriodRow[],
  plan: SyncPlan,
  today: string,
): Map<string, PeriodSpan[]> {
  const out = new Map<string, PeriodSpan[]>();
  const sourced = new Map(rhythms.filter((r) => r.source).map((r) => [r.id, r]));
  const add = (itemId: string, span: PeriodSpan) => {
    const list = out.get(itemId) ?? [];
    if (!list.some((s) => s.startsOn === span.startsOn)) {
      list.push({ startsOn: span.startsOn, endsOn: span.endsOn });
    }
    out.set(itemId, list);
  };
  for (const row of rows) {
    const rhythm = sourced.get(row.itemId);
    if (!rhythm) continue;
    // The current period is read over the rhythm's own dates, which a
    // reshape may be about to give it.
    const current = periodOf(rhythm.period, today);
    const previous = periodOf(rhythm.period, addDays(current.startsOn, -1)).startsOn;
    if (row.startsOn === current.startsOn) add(row.itemId, current);
    else if (row.closedAt === null || row.startsOn === previous) add(row.itemId, row);
  }
  for (const row of plan.insert) if (sourced.has(row.itemId)) add(row.itemId, row);
  return out;
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

/** "1 of 3 this week", and "2 of 5 this week · from Jobs" for a rhythm that counts itself. */
export function progressLine(
  period: RhythmPeriod,
  row: Pick<PeriodRow, 'target' | 'count'>,
  source?: CountSource | null,
) {
  return `${row.count} of ${row.target} ${periodLabel(period)}${sourceSuffix(source)}`;
}

/**
 * A rhythm's current period and the closed ones before it, oldest first.
 * `missed` is how many periods in a row were missed up to the current one,
 * counted over every stored row rather than only the PAST_SHOWN kept here.
 */
export type RhythmRecord = { current: PeriodRow | null; past: PeriodRow[]; missed: number };

/** Group stored rows into a record per rhythm, keeping the last PAST_SHOWN. */
export function recordsOf(rows: PeriodRow[], today: string): Map<string, RhythmRecord> {
  const out = new Map<string, RhythmRecord>();
  const sorted = [...rows].sort((a, b) =>
    a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0,
  );
  for (const row of sorted) {
    const record = out.get(row.itemId) ?? { current: null, past: [], missed: 0 };
    if (row.closedAt === null && row.startsOn <= today && today < row.endsOn) {
      record.current = row;
    } else if (row.closedAt !== null) {
      record.past.push(row);
    }
    out.set(row.itemId, record);
  }
  for (const record of out.values()) {
    record.missed = missedRun(record.past);
    record.past = record.past.slice(-PAST_SHOWN);
  }
  return out;
}

/** Closed periods missed in a row at the end of `past`, which is oldest first. */
function missedRun(past: PeriodRow[]): number {
  let run = 0;
  for (let i = past.length - 1; i >= 0 && past[i].kept === false; i--) run++;
  return run;
}

export type AtRiskRhythm = LiveRhythm & { count: number; daysLeft: number };

/**
 * A rhythm as the home shows it after time away (docs/GOALS-SPEC.md, "Coming
 * back after time away"; plan #935): this period's progress, and the missed
 * periods before it folded into one count rather than listed one by one.
 */
export type HomeRhythm = AtRiskRhythm & {
  atRisk: boolean;
  missed: number;
  /** The current period's first day (YYYY-MM-DD), which logging one against it names. */
  startsOn: string;
};

/**
 * The live rhythms the home shows, one each, in the order they came: those
 * at risk this period, and those with missed periods behind them whose
 * current period is not yet met. Once this period is met the misses stop
 * being shown; they stay in the stored periods and the history either way.
 */
export function homeRhythms(
  rhythms: LiveRhythm[],
  records: Map<string, RhythmRecord>,
  today: string,
): HomeRhythm[] {
  const out: HomeRhythm[] = [];
  for (const rhythm of rhythms) {
    const record = records.get(rhythm.id);
    const current = record?.current;
    if (!current) continue;
    const atRisk = isAtRisk(rhythm.period, current, today);
    const missed = current.count < current.target ? (record?.missed ?? 0) : 0;
    if (!atRisk && missed === 0) continue;
    out.push({
      ...rhythm,
      count: current.count,
      daysLeft: daysLeft(current, today),
      atRisk,
      missed,
      startsOn: current.startsOn,
    });
  }
  return out;
}

const PERIOD_NOUNS: Record<RhythmPeriod, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
};

/** "3 weeks missed", "1 day missed". */
export function missedLine(period: RhythmPeriod, missed: number): string {
  const [one, many] = PERIOD_NOUNS[period];
  return `${missed} ${missed === 1 ? one : many} missed`;
}

/** A practice as an area's page lists it: this period's count against its target, and misses behind it. */
export type Practice = LiveRhythm & { count: number; missed: number };

/**
 * Every live rhythm with this period's progress, for an area's page, in the
 * order they came. A rhythm with no current period yet reads as 0 so far.
 */
export function practices(rhythms: LiveRhythm[], records: Map<string, RhythmRecord>): Practice[] {
  return rhythms.map((rhythm) => {
    const record = records.get(rhythm.id);
    const current = record?.current;
    return {
      ...rhythm,
      target: current?.target ?? rhythm.target,
      count: current?.count ?? 0,
      missed: current && current.count < current.target ? (record?.missed ?? 0) : 0,
    };
  });
}
