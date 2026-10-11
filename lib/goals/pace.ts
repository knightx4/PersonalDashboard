/**
 * A goal's usual pace, worked out from what you did on it (plan #1737;
 * docs/GOALS-SPEC.md, "Goals without a deadline").
 *
 * Most goals have no deadline, so there is no date to fall behind. What they
 * do have is a rhythm of their own: the days something happened on them. An
 * active day is a day on which you closed one of the goal's steps, logged
 * progress on it, counted one of its rhythms, or filed a capture against it.
 * From those days over the last eight weeks this works out how many days
 * usually pass between active days, the last active day, and whether the
 * gap since then is more than one and a half times the usual one.
 *
 * Too little history says nothing: fewer than PACE_ENOUGH_DAYS active days in
 * the last PACE_ENOUGH_WITHIN days reads "not enough to tell yet". Both are
 * named here so the threshold is one edit.
 *
 * Pure. lib/goals/pace-store.ts reads the rows; the goal page and the
 * morning review (plan #1738) read the result.
 */
import type { FiledEntry } from '@/lib/goals/capture';
import type { StepKind, StepStatus } from '@/lib/goals/steps';
import { addDays } from '@/lib/todo/tasks/model';
import { dayIn } from '@/lib/todo/time';

/** How far back the active days are read: eight weeks. */
export const PACE_WINDOW_DAYS = 56;

/** The fewest active days that make a pace worth stating. */
export const PACE_ENOUGH_DAYS = 4;

/** ...within this many days before today: six weeks. */
export const PACE_ENOUGH_WITHIN = 42;

/** A gap this many times the usual one reads as slower than usual. */
export const PACE_SLOWER_FACTOR = 1.5;

/** A step of the goal, as much as pace reads. */
export type PaceStep = { kind: StepKind; status: StepStatus; closedAt?: string | null };

/** A rhythm period of one of the goal's steps. */
export type PacePeriod = {
  startsOn: string;
  /** The day after the period's last day. */
  endsOn: string;
  count: number;
  /** When the count last moved, near enough: the row's updated_at. */
  updatedAt: string;
};

/** A capture, with what it filed. */
export type PaceCapture = { createdAt: string; filed: readonly FiledEntry[] };

export type PaceSources = {
  /** Every step under the goal, at any depth. */
  steps: readonly PaceStep[];
  /** Progress logged on the goal or its steps; happenedOn is YYYY-MM-DD. */
  progress: readonly { happenedOn: string }[];
  /** The periods of the goal's rhythms. */
  periods: readonly PacePeriod[];
  /** Captures in the window; only lines filed on `itemIds` count. */
  captures: readonly PaceCapture[];
  /** The goal and every step under it. */
  itemIds: ReadonlySet<string>;
};

export type GoalPace =
  | {
      known: false;
      /** Active days in the last PACE_ENOUGH_WITHIN days. */
      activeDays: number;
      lastOn: string | null;
      daysSince: number | null;
    }
  | {
      known: true;
      activeDays: number;
      /** The usual number of days between one active day and the next. */
      typicalGap: number;
      lastOn: string;
      daysSince: number;
      /** The gap since the last active day is over PACE_SLOWER_FACTOR times the usual one. */
      slower: boolean;
    };

/** Whole days from one YYYY-MM-DD to another; negative when `to` is earlier. */
export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The day a filed line records something done, or null for a line that does not. */
function filedDay(entry: FiledEntry, capturedOn: string, itemIds: ReadonlySet<string>): string | null {
  if (entry.undone_at) return null;
  switch (entry.kind) {
    case 'close':
      return itemIds.has(entry.step_id) ? capturedOn : null;
    case 'count':
      return itemIds.has(entry.step_id) ? (entry.counted_on ?? capturedOn) : null;
    case 'progress':
      return itemIds.has(entry.item_id) ? entry.happened_on : null;
    case 'reading':
    case 'note':
      return itemIds.has(entry.goal_id) ? capturedOn : null;
    case 'add':
      // A step added is a plan, not a thing done, unless it came with progress.
      return entry.progress && itemIds.has(entry.step_id) ? capturedOn : null;
    default:
      return null;
  }
}

/**
 * The days something was done on the goal, oldest first, each once, from
 * `today` back PACE_WINDOW_DAYS days. Instants are read as days in the
 * account's zone. A step Dash closed is Dash's doing, not yours, and is left
 * out; a counted period is placed on the day its count last moved, kept
 * within the period.
 */
export function activeDays(sources: PaceSources, today: string, timeZone: string): string[] {
  const from = addDays(today, -(PACE_WINDOW_DAYS - 1));
  const days = new Set<string>();
  const add = (day: string | null) => {
    if (day && day >= from && day <= today) days.add(day);
  };
  for (const step of sources.steps) {
    if (step.status === 'done' && step.kind !== 'claude' && step.closedAt) {
      add(dayIn(step.closedAt, timeZone));
    }
  }
  for (const entry of sources.progress) add(entry.happenedOn);
  for (const period of sources.periods) {
    if (period.count <= 0) continue;
    const last = addDays(period.endsOn, -1);
    const moved = dayIn(period.updatedAt, timeZone);
    add(moved < period.startsOn ? period.startsOn : moved > last ? last : moved);
  }
  for (const capture of sources.captures) {
    const on = dayIn(capture.createdAt, timeZone);
    for (const entry of capture.filed) add(filedDay(entry, on, sources.itemIds));
  }
  return [...days].sort();
}

/** The middle value, halfway between the two middles for an even count, to the nearest day. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The goal's pace from its active days (sorted, as `activeDays` returns
 * them). The usual gap is the median of the gaps between active days in the
 * window, so one long break or one busy weekend does not set it.
 */
export function goalPace(days: readonly string[], today: string): GoalPace {
  const lastOn = days.length > 0 ? days[days.length - 1] : null;
  const daysSince = lastOn ? daysFrom(lastOn, today) : null;
  const enoughFrom = addDays(today, -(PACE_ENOUGH_WITHIN - 1));
  const recent = days.filter((day) => day >= enoughFrom).length;
  if (recent < PACE_ENOUGH_DAYS || lastOn === null || daysSince === null) {
    return { known: false, activeDays: recent, lastOn, daysSince };
  }
  const gaps = days.slice(1).map((day, i) => daysFrom(days[i], day));
  const typicalGap = Math.max(1, median(gaps));
  return {
    known: true,
    activeDays: recent,
    typicalGap,
    lastOn,
    daysSince,
    slower: daysSince > typicalGap * PACE_SLOWER_FACTOR,
  };
}

/** "today", "yesterday", "5 days ago". */
export function agoWords(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** "every day", "every 5 days". */
function everyWords(gap: number): string {
  return gap <= 1 ? 'every day' : `every ${gap} days`;
}

/**
 * The usual pace as the goal's properties say it: "Every 5 days", "Every
 * day", or "Not enough to tell yet" while the history is too thin.
 */
export function paceWords(pace: GoalPace): string {
  if (!pace.known) return 'Not enough to tell yet';
  const every = everyWords(pace.typicalGap);
  return every[0].toUpperCase() + every.slice(1);
}

/** The last active day as the properties say it: "2 days ago", "Today"; null when there is none. */
export function lastActiveWords(pace: GoalPace): string | null {
  if (pace.daysSince === null) return null;
  const ago = agoWords(pace.daysSince);
  return ago[0].toUpperCase() + ago.slice(1);
}

/**
 * The pace as the goal's status line says it, lower case to sit after a
 * separator: "usually every 5 days, last 2 days ago", or, with too little
 * history, the last active day alone ("last active 3 days ago"), or nothing
 * when nothing has been done in the window.
 */
export function paceLine(pace: GoalPace): string | null {
  if (pace.known) return `usually ${everyWords(pace.typicalGap)}, last ${agoWords(pace.daysSince)}`;
  return pace.daysSince === null ? null : `last active ${agoWords(pace.daysSince)}`;
}

/** Why the pace reads as it does, for the property's hint. */
export function paceHint(pace: GoalPace): string {
  const counted =
    'Counted from the days you closed a step, logged progress, ticked a rhythm or filed a line on this goal, over the last eight weeks.';
  if (!pace.known) {
    return `${counted} A pace needs ${PACE_ENOUGH_DAYS} active days in six weeks; this goal has ${pace.activeDays}.`;
  }
  return pace.slower
    ? `${counted} The gap since the last one is longer than usual.`
    : counted;
}
