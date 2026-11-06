import { whenDay } from '@/lib/core/when';
import type { WatchCard } from '@/lib/you/watch-card-model';

/**
 * What a person's edit form and their thread show of their reach-out rule
 * (plan #2931.3): the words you wrote, what Dash made of them, what it cannot
 * watch, and when the next text should come.
 *
 * The next text follows the daily round's own clock (watchClock in
 * reach-out-due.ts): a watch that has never sent is due at once, and one
 * that has is due its cadence after the last row it named, less the round's
 * slack. The earliest watch decides. Due now means the next daily round,
 * which runs once a day outside quiet hours, so the line never names an hour.
 * The view is built on the server (reach-out-card.ts); this file is what the
 * form and the thread need to draw it, and imports nothing that calls a model.
 */

export type ReachOutView = {
  /** What you wrote; empty when nothing is. */
  brief: string;
  /** What Dash understood, without the sentence about what it cannot watch; null with no rule. */
  summary: string | null;
  /** What the brief asked for that Dash cannot watch. */
  cannotWatch: string[];
  /** Why no rule could be made from the brief; null when one was, or none was asked for. */
  error: string | null;
  /** When the next text is due: at null, the next daily round. Null with no rule. */
  next: { at: string | null } | null;
  /**
   * Watches Dash wrote for what no fixed watch reads, waiting for your OK
   * (plan #3030.2): the whole brief when nothing in it was covered, or the
   * parts the rule could not watch. None when absent.
   */
  watches?: WatchCard[];
};

export const NO_REACH_OUT: ReachOutView = { brief: '', summary: null, cannotWatch: [], error: null, next: null };

/** The three caps any text may wait on, as the card says them (you.advisor_texts_cap). */
export const REACH_OUT_CAPS =
  'At most three texts a day come from everyone together, one unread at a time from each, and none from 10 PM to 8 AM, so a text can wait a round.';

/** "Monday, if there is something new", or "At the next daily round, if there is something new". */
export function nextTextWhen(next: { at: string | null }, options: { timeZone: string; now: number }): string {
  if (next.at === null || Date.parse(next.at) <= options.now) return 'At the next daily round, if there is something new';
  return `${whenDay(next.at, options)}, if there is something new`;
}

/** The thread header's line, short enough for one line at 390: "Next text Monday, if there is news". */
export function nextTextLine(next: { at: string | null }, options: { timeZone: string; now: number }): string {
  if (next.at === null || Date.parse(next.at) <= options.now) return 'Next text at the next round, if there is news';
  const day = whenDay(next.at, options);
  // Today and Tomorrow run on in lower case; a weekday or a date keeps its capital.
  return `Next text ${/^(Today|Tomorrow)$/.test(day) ? day.toLowerCase() : day}, if there is news`;
}
