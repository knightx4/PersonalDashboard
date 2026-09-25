/**
 * The catch-up the Goals home leads with after time away (plan #1019;
 * docs/GOALS-SPEC.md, "Coming back after time away").
 *
 * The home keeps one goals.visits row per person (supabase/migrations-goals/
 * 0027). Each visit moves `lastVisitAt` to now. When the gap since the last
 * visit is AWAY_DAYS or more, the visit also records when the time away
 * started (`awayFrom`) and the day you came back (`backOn`). The catch-up
 * shows while `backOn` is today: it survives going into a goal and back, and
 * opening the home the next day finds an ordinary daily view.
 *
 * The catch-up itself is three things, in this order: the runs Claude
 * finished while you were away, what is waiting on you, and one next step per
 * goal. Everything else on the home is folded under it.
 *
 * Pure. The read and write are in lib/goals/visits-store.ts.
 */
import type { DailyGoal, NextItem, WaitingItem } from '@/lib/goals/daily';
import type { RunListing } from '@/lib/goals/runs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** This many days or more since the last visit counts as time away. */
export const AWAY_DAYS = 5;

/** The most finished runs the catch-up lists; the rest are on the Runs page. */
export const CATCH_UP_RUNS_SHOWN = 6;

export type VisitRecord = {
  /** ISO instant of the latest visit. */
  lastVisitAt: string;
  /** ISO instant of the visit before the time away; null when there has been none. */
  awayFrom: string | null;
  /** YYYY-MM-DD you came back on, in the account's zone; null alongside awayFrom. */
  backOn: string | null;
};

/**
 * The record after a visit at `now` on `today`. A first visit has nothing to
 * catch up on. A gap of AWAY_DAYS or more starts a catch-up for today; a
 * shorter one leaves the last catch-up's fields as they were, so a second
 * visit on the day you came back still shows it.
 */
export function nextVisit(record: VisitRecord | null, now: Date, today: string): VisitRecord {
  const lastVisitAt = now.toISOString();
  if (!record) return { lastVisitAt, awayFrom: null, backOn: null };
  const gap = now.getTime() - Date.parse(record.lastVisitAt);
  if (gap >= AWAY_DAYS * DAY_MS) {
    return { lastVisitAt, awayFrom: record.lastVisitAt, backOn: today };
  }
  return { lastVisitAt, awayFrom: record.awayFrom, backOn: record.backOn };
}

/** When the time away began, if today is the day you came back from it; otherwise null. */
export function catchUpSince(record: VisitRecord | null, today: string): string | null {
  if (!record || record.backOn !== today) return null;
  return record.awayFrom;
}

export type CatchUp = {
  /** ISO instant the time away began. */
  since: string;
  /** Runs that finished while you were away, newest first, at most CATCH_UP_RUNS_SHOWN. */
  runs: RunListing[];
  /** Finished runs left out by the cap. */
  moreRuns: number;
  waiting: WaitingItem[];
  /** The first next item of each goal that has one, in the home's goal order. */
  next: { goalId: string; goalTitle: string; item: NextItem }[];
};

export function catchUp(
  since: string,
  runs: RunListing[],
  view: { goals: DailyGoal[]; waiting: WaitingItem[] },
): CatchUp {
  const from = Date.parse(since);
  const finished = runs
    .filter(
      (run) => run.status === 'done' && run.endedAt !== null && Date.parse(run.endedAt) > from,
    )
    .sort((a, b) => Date.parse(b.endedAt as string) - Date.parse(a.endedAt as string));
  return {
    since,
    runs: finished.slice(0, CATCH_UP_RUNS_SHOWN),
    moreRuns: Math.max(0, finished.length - CATCH_UP_RUNS_SHOWN),
    waiting: view.waiting,
    next: view.goals.flatMap((daily) =>
      daily.next.length > 0
        ? [{ goalId: daily.goal.id, goalTitle: daily.goal.title, item: daily.next[0] }]
        : [],
    ),
  };
}
