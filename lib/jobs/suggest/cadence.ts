/**
 * When the daily run writes new suggestions.
 *
 * The cron calls every day. People to meet are written every three days, and
 * only while fewer than three are open: a list the person has not got to does
 * not need more on top. Postings are written once a week. Both runs pay for
 * web searches, which is what keeps them this infrequent.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type SuggestionKind = 'reach_out' | 'apply';

export const CADENCE: Record<SuggestionKind, { everyDays: number; maxOpen: number }> = {
  reach_out: { everyDays: 3, maxOpen: 3 },
  apply: { everyDays: 7, maxOpen: 5 },
};

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
  // Half a day of slack, so a daily cron that fires a few minutes early is
  // not pushed to the next day.
  return now.getTime() - new Date(state.lastRunAt).getTime() >= (everyDays - 0.5) * DAY_MS;
}
