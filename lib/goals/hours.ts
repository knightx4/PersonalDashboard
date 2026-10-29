import { periodOf } from '@/lib/goals/rhythms';
import { addDays } from '@/lib/todo/tasks/model';

/**
 * The Hours page (/goals/hours, migration goals 0089): every weekly hours
 * metric across the goals, read together. A metric whose source is hours
 * adds up the time logged on its goal ("applied 2h" in the capture box); this
 * file turns each one's logged days into what the page draws. Pure, so the
 * page and its tests agree.
 *
 * The aim is per week, Monday to Sunday, and the pace counts weekdays: an aim
 * of 10 expects 2 by the end of Monday and 10 by the end of Friday. Time
 * logged at the weekend counts towards the week's total but adds nothing to
 * what the pace expects.
 */

/** A day's hours on one metric. */
export type LoggedDay = { day: string; hours: number };

export type HoursMetric = {
  id: string;
  name: string;
  goalId: string;
  goalTitle: string;
  target: number | null;
  targetHigh: number | null;
  days: LoggedDay[];
};

/** How the week stands against the pace. */
export type PaceState = 'ahead' | 'on pace' | 'behind' | 'no aim';

export type WeekStanding = {
  hours: number;
  /** What the aim's low end expects by the end of today. */
  expected: number | null;
  pace: PaceState;
  /** Hours above (positive) or below (negative) the expected, to the tenth. */
  gap: number | null;
};

export type HoursRow = {
  metric: HoursMetric;
  /** Hours on each day of the grid, oldest first. */
  grid: number[];
  week: WeekStanding;
  /** The last twelve weeks' totals, oldest first, this week last. */
  weeks: { startsOn: string; hours: number }[];
  /** The average per weekday over the last four full weeks. */
  perWeekday: number;
  /** Of the last eight full weeks, how many reached the aim's low end. */
  weeksOnAim: number | null;
  /** Full weeks in a row, ending last week, that reached the aim's low end. */
  streak: number | null;
  /** The best full week of the twelve. */
  best: number;
};

export type HoursPage = {
  /** The days of the grid, oldest first: four weeks from a Monday to today's Sunday. */
  gridDays: string[];
  today: string;
  /** The Monday of this week. */
  weekStart: string;
  rows: HoursRow[];
  /** Every metric added up, the same shapes as a row's. */
  total: { grid: number[]; week: WeekStanding; weeks: { startsOn: string; hours: number }[] };
  /** The highest hours on any one day of the grid across the rows, the shading's top. */
  dayHigh: number;
};

export const GRID_WEEKS = 4;
export const TREND_WEEKS = 12;
const ON_PACE_SLACK = 0.5;

const round = (value: number) => Math.round(value * 100) / 100;

/** Weekdays from Monday to `day` inclusive, 0 to 5. */
export function weekdaysThrough(day: string): number {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 5 : Math.min(weekday, 5);
}

/** Whether a day falls on a Saturday or Sunday. */
export function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function standing(hours: number, target: number | null, today: string): WeekStanding {
  if (target === null) return { hours, expected: null, pace: 'no aim', gap: null };
  const expected = round((target * weekdaysThrough(today)) / 5);
  const gap = Math.round((hours - expected) * 10) / 10;
  const pace: PaceState = gap > ON_PACE_SLACK ? 'ahead' : gap < -ON_PACE_SLACK ? 'behind' : 'on pace';
  return { hours, expected, pace, gap };
}

function byDay(days: LoggedDay[]): Map<string, number> {
  const sums = new Map<string, number>();
  for (const { day, hours } of days) sums.set(day, round((sums.get(day) ?? 0) + hours));
  return sums;
}

function weekTotals(sums: Map<string, number>, weekStart: string): { startsOn: string; hours: number }[] {
  const weeks: { startsOn: string; hours: number }[] = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) {
    const startsOn = addDays(weekStart, -7 * i);
    let hours = 0;
    for (let d = 0; d < 7; d += 1) hours += sums.get(addDays(startsOn, d)) ?? 0;
    weeks.push({ startsOn, hours: round(hours) });
  }
  return weeks;
}

/** Everything the Hours page draws, for these metrics as of `today`. */
export function hoursPage(metrics: HoursMetric[], today: string): HoursPage {
  const weekStart = periodOf('week', today).startsOn;
  const gridStart = addDays(weekStart, -7 * (GRID_WEEKS - 1));
  const gridDays = Array.from({ length: 7 * GRID_WEEKS }, (_, i) => addDays(gridStart, i));
  const allSums = new Map<string, number>();

  const rows = metrics.map((metric): HoursRow => {
    // Time logged after today is a misreading of the day, and left out.
    const sums = byDay(metric.days.filter((d) => d.day <= today));
    for (const [day, hours] of sums) allSums.set(day, round((allSums.get(day) ?? 0) + hours));
    const weeks = weekTotals(sums, weekStart);
    const full = weeks.slice(0, -1);
    const lastFour = full.slice(-4);
    const lastEight = full.slice(-8);
    let streak = 0;
    if (metric.target !== null) {
      for (let i = full.length - 1; i >= 0 && full[i].hours >= metric.target; i -= 1) streak += 1;
    }
    return {
      metric,
      grid: gridDays.map((day) => sums.get(day) ?? 0),
      week: standing(weeks[weeks.length - 1].hours, metric.target, today),
      weeks,
      perWeekday: round(lastFour.reduce((sum, w) => sum + w.hours, 0) / (lastFour.length * 5)),
      weeksOnAim:
        metric.target === null ? null : lastEight.filter((w) => w.hours >= (metric.target as number)).length,
      streak: metric.target === null ? null : streak,
      best: Math.max(0, ...full.map((w) => w.hours)),
    };
  });

  const aims = metrics.map((m) => m.target);
  const totalTarget = aims.length > 0 && aims.every((t) => t !== null)
    ? aims.reduce((sum: number, t) => sum + (t as number), 0)
    : null;
  const totalWeeks = weekTotals(allSums, weekStart);
  return {
    gridDays,
    today,
    weekStart,
    rows,
    total: {
      grid: gridDays.map((day) => allSums.get(day) ?? 0),
      week: standing(totalWeeks[totalWeeks.length - 1].hours, totalTarget, today),
      weeks: totalWeeks,
    },
    dayHigh: Math.max(0, ...rows.flatMap((row) => row.grid)),
  };
}

/** "2.5 h", "0 h". */
export function hoursText(hours: number): string {
  return `${Math.round(hours * 10) / 10} h`;
}

/** "10–15 h a week", "10 h a week". */
export function aimText(target: number | null, targetHigh: number | null): string | null {
  if (target === null) return null;
  return targetHigh !== null && targetHigh > target ? `${target}–${targetHigh} h a week` : `${target} h a week`;
}

/** "1.5 h ahead of pace", "On pace", "2 h behind pace", or null with no aim. */
export function paceText(week: WeekStanding): string | null {
  if (week.pace === 'no aim' || week.gap === null) return null;
  if (week.pace === 'on pace') return 'On pace';
  return `${hoursText(Math.abs(week.gap))} ${week.pace === 'ahead' ? 'ahead of' : 'behind'} pace`;
}

/**
 * The shade of a day's cell, 0 to 4: none, then quarters of the grid's top.
 * Any time at all is at least 1, so a short day never reads as nothing.
 */
export function shadeOf(hours: number, high: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0 || high <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((hours / high) * 4))) as 1 | 2 | 3 | 4;
}
