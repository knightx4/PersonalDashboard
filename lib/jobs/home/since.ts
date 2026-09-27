/**
 * What came in since your last visit to the Jobs home (plan #1152).
 *
 * Home keeps one job_search.home_visits row per person
 * (supabase/migrations-job-search/0034_home_visits.sql), written on every
 * load. The list starts at the last visit before this sitting: page loads
 * less than SITTING_MINUTES apart are one sitting, so reloading Home after
 * acting on something does not empty the list. A first visit has nothing to
 * start from and looks back FIRST_VISIT_DAYS instead.
 *
 * Pure. The read and write are in lib/jobs/home/visits-store.ts.
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Page loads closer together than this are one sitting, as on the Goals home. */
export const SITTING_MINUTES = 30;

/** How far back the list looks when there is no earlier visit. */
export const FIRST_VISIT_DAYS = 7;

/** At most this many changes on Home; the Activity tab has the rest. */
export const SINCE_LIMIT = 8;

export type HomeVisit = {
  /** ISO instant of the latest visit. */
  lastVisitAt: string;
  /** ISO instant of the last visit before this sitting; null until there has been one. */
  previousVisitAt: string | null;
};

/**
 * The record after a visit at `now`. A gap of SITTING_MINUTES or more starts
 * a new sitting, whose previous visit is the last one; a shorter gap keeps
 * the sitting's previous visit.
 */
export function nextHomeVisit(record: HomeVisit | null, now: Date): HomeVisit {
  const lastVisitAt = now.toISOString();
  if (!record) return { lastVisitAt, previousVisitAt: null };
  const gap = now.getTime() - Date.parse(record.lastVisitAt);
  const previousVisitAt =
    gap >= SITTING_MINUTES * MINUTE_MS ? record.lastVisitAt : record.previousVisitAt;
  return { lastVisitAt, previousVisitAt };
}

/** Where the list starts: the previous visit, or FIRST_VISIT_DAYS back on a first one. */
export function sinceOf(record: HomeVisit, now: Date): { since: string; firstVisit: boolean } {
  if (record.previousVisitAt) return { since: record.previousVisitAt, firstVisit: false };
  return {
    since: new Date(now.getTime() - FIRST_VISIT_DAYS * DAY_MS).toISOString(),
    firstVisit: true,
  };
}

/** A mailbox as Home reads it, for the stopped-syncing check. */
export type InboxState = { id: string; emailAddress: string; status: string };

/**
 * The mailboxes that have stopped syncing: the sync marks one `needs_reauth`
 * when Google refuses the token and `error` when a run fails outright. A
 * `disconnected` one was disconnected on purpose, so it is not news.
 */
export function stoppedInboxes(accounts: readonly InboxState[]): InboxState[] {
  return accounts.filter((account) => account.status === 'needs_reauth' || account.status === 'error');
}
