/**
 * Whether this month's review has been opened on this device (plan
 * #2593.8.3). The review opens on the first visit in a month and is closed
 * after, so the page reads a cookie the review sets when it is first shown.
 * Kept apart from show.ts so the client sets it without loading the rest.
 */

/** The cookie holding the YYYY-MM of the last review shown open. */
export const REVIEW_SEEN_COOKIE = 'finances-review-seen';

/** A year: the cookie only has to outlive the month. */
export const REVIEW_SEEN_MAX_AGE = 60 * 60 * 24 * 365;

/** Open on the first visit to a month's review, closed after. */
export function reviewStartsOpen(month: string, seen: string | undefined): boolean {
  return seen !== month;
}
