/**
 * When the daily run writes new suggestions.
 *
 * The cron calls every day. People to meet are written every three days and
 * postings once a week, each only while the list on its page (Contacts,
 * Roles) is short of full: a list the person has not got to does not need more
 * on top. A list that has been emptied, by acting on or turning down
 * everything in it, is refilled the next day instead of waiting out the
 * interval, since an empty section is the one that looks broken. Both runs pay
 * for web searches, which is what keeps them this infrequent.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type SuggestionKind = 'reach_out' | 'apply';

export const CADENCE: Record<SuggestionKind, { everyDays: number; maxOpen: number }> = {
  reach_out: { everyDays: 3, maxOpen: 5 },
  apply: { everyDays: 7, maxOpen: 8 },
};

/** How soon an emptied list is refilled. */
const EMPTY_REFILL_DAYS = 1;

/**
 * Whether a run of this kind is due.
 *
 * `lastRunAt` is the newest suggestion of the kind, whatever became of it, so
 * a run that found nothing is retried on the next day rather than a week on.
 */
export function suggestionDue(
  kind: SuggestionKind,
  state: { lastRunAt: string | null; open: number },
  now: Date = new Date(),
): boolean {
  const { everyDays, maxOpen } = CADENCE[kind];
  if (state.open >= maxOpen) return false;
  if (!state.lastRunAt) return true;
  const wait = state.open === 0 ? EMPTY_REFILL_DAYS : everyDays;
  // Half a day of slack, so a daily cron that fires a few minutes early is
  // not pushed to the next day.
  return now.getTime() - new Date(state.lastRunAt).getTime() >= (wait - 0.5) * DAY_MS;
}
