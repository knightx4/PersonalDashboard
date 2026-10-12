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
 * On that day the home says how long you were away and opens the line for
 * what Dash did while you were gone (lib/goals/done-since.ts, the same list
 * as any other sitting's). Do next already holds what is waiting, so the
 * catch-up adds no list of its own.
 *
 * Pure. The read and write are in lib/goals/visits-store.ts.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** This many days or more since the last visit counts as time away. */
export const AWAY_DAYS = 5;

/**
 * Page loads closer together than this are one sitting (plan #1010). The list
 * of what Claude did since your last visit reads from the visit before the
 * sitting began, so reloading the home, or a press on it that reloads it,
 * does not empty the list; the next sitting does.
 */
export const SITTING_MINUTES = 30;

export type VisitRecord = {
  /** ISO instant of the latest visit. */
  lastVisitAt: string;
  /** ISO instant of the visit before the time away; null when there has been none. */
  awayFrom: string | null;
  /** YYYY-MM-DD you came back on, in the account's zone; null alongside awayFrom. */
  backOn: string | null;
  /**
   * ISO instant of the last visit before this sitting (plan #1010); null
   * until there has been one. What Claude did since then leads the home.
   */
  previousVisitAt: string | null;
};

/**
 * The record after a visit at `now` on `today`. A first visit has nothing to
 * catch up on. A gap of AWAY_DAYS or more starts a catch-up for today; a
 * shorter one leaves the last catch-up's fields as they were, so a second
 * visit on the day you came back still shows it.
 *
 * A gap of SITTING_MINUTES or more starts a new sitting, whose previous visit
 * is the last one; a shorter gap keeps the sitting's previous visit.
 */
export function nextVisit(record: VisitRecord | null, now: Date, today: string): VisitRecord {
  const lastVisitAt = now.toISOString();
  if (!record) return { lastVisitAt, awayFrom: null, backOn: null, previousVisitAt: null };
  const gap = now.getTime() - Date.parse(record.lastVisitAt);
  const previousVisitAt =
    gap >= SITTING_MINUTES * 60 * 1000 ? record.lastVisitAt : record.previousVisitAt;
  if (gap >= AWAY_DAYS * DAY_MS) {
    return { lastVisitAt, awayFrom: record.lastVisitAt, backOn: today, previousVisitAt };
  }
  return { lastVisitAt, awayFrom: record.awayFrom, backOn: record.backOn, previousVisitAt };
}

/** When the time away began, if today is the day you came back from it; otherwise null. */
export function catchUpSince(record: VisitRecord | null, today: string): string | null {
  if (!record || record.backOn !== today) return null;
  return record.awayFrom;
}

/**
 * Whole days between the visit before the time away and `today`, both read
 * as days in UTC. Rough by up to a day around midnight, which is fine for
 * "back after 6 days".
 */
export function daysAway(awayFrom: string, today: string): number {
  const from = Date.parse(`${awayFrom.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / DAY_MS));
}
