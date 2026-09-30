/**
 * What a posting's own text says, for the posting check (posting.ts). Pure,
 * so it is tested without fetching.
 */

/** The longest posting text stored (the column allows 20,000 characters). */
export const POSTING_TEXT_MAX = 20_000;

/** How much of the posting Jev reads. The requirements and pay are near the top. */
export const POSTING_TEXT_FOR_SCORING = 6_000;

/**
 * Phrases a careers page shows in place of a posting that has closed. Read
 * only from the top of the page, where the notice sits; further down the same
 * words can belong to a different posting in a "similar jobs" list.
 */
const CLOSED_NOTICES = [
  /no longer (accepting|taking) applications/,
  /(job|position|posting|role|vacancy) (is )?no longer (available|open|active)/,
  /(job|position|posting|role) (has )?(been )?(filled|closed|expired|removed)/,
  /this (job|position|posting|role) (has )?expired/,
  /the (job|page|position) you are looking for (is no longer|could not be|can ?not be|was not) (available|found)/,
  /\bjob not found\b/,
];

export function postingLooksClosed(text: string): boolean {
  const top = text.slice(0, 1500).toLowerCase().replace(/\s+/g, ' ');
  return CLOSED_NOTICES.some((pattern) => pattern.test(top));
}
