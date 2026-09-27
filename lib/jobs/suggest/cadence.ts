/**
 * When the daily run writes new suggestions.
 *
 * The cron calls every day. People to meet are written every three days and
 * postings once a week, each only while the list on its page (Contacts,
 * Roles) is short of full: a list the person has not got to does not need more
 * on top. A list that has been emptied, by acting on or turning down
 * everything the last run found, is refilled by the next daily run instead of
 * waiting out the interval, since an empty section is the one that looks
 * broken. A run that found nothing waits the full interval, so an account with
 * little to search from is not searched at a cost every day. Both runs pay for
 * web searches, which is what keeps them this infrequent.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type SuggestionKind = 'reach_out' | 'apply';

export const CADENCE: Record<SuggestionKind, { everyDays: number; maxOpen: number }> = {
  reach_out: { everyDays: 3, maxOpen: 5 },
  apply: { everyDays: 7, maxOpen: 8 },
};

/**
 * How soon an emptied list is refilled: by the next daily run, which is at
 * least this long after a press of Search now earlier the same day.
 */
const EMPTIED_REFILL_HOURS = 6;

export type CadenceState = {
  /** When this kind last ran, whether or not it found anything. */
  lastRunAt: string | null;
  open: number;
  /**
   * The last run stored suggestions and none is open any more: the person
   * acted on or turned down everything it found. A run that found nothing is
   * not this, and waits out the full interval.
   */
  emptied: boolean;
};

/** Whether a run of this kind is due. */
export function suggestionDue(kind: SuggestionKind, state: CadenceState, now: Date = new Date()): boolean {
  const { everyDays, maxOpen } = CADENCE[kind];
  if (state.open >= maxOpen) return false;
  if (!state.lastRunAt) return true;
  const since = now.getTime() - new Date(state.lastRunAt).getTime();
  if (state.emptied) return since >= EMPTIED_REFILL_HOURS * 3_600_000;
  // Half a day of slack, so a daily cron that fires a few minutes early is
  // not pushed to the next day.
  return since >= (everyDays - 0.5) * DAY_MS;
}

/**
 * Where a kind stands, from its stored suggestions (newest first) and the
 * profile's record of the last run. Before that record existed, the newest
 * suggestion stands in for the run.
 */
export function cadenceState(
  rows: readonly { status: string; createdAt: string }[],
  searchedAt: string | null,
): CadenceState {
  const newest = rows[0]?.createdAt ?? null;
  // Compared as instants: the database and toISOString() write the same time
  // in different string forms.
  const lastRunAt =
    searchedAt && (!newest || new Date(searchedAt).getTime() > new Date(newest).getTime()) ? searchedAt : newest;
  const open = rows.filter((row) => row.status === 'open').length;
  // The last run stored something if its newest row is only minutes older
  // than the run's record, which is written after the inserts.
  const lastRunStored =
    !!newest && !!lastRunAt && new Date(lastRunAt).getTime() - new Date(newest).getTime() < 10 * 60_000;
  return { lastRunAt, open, emptied: open === 0 && lastRunStored };
}
