import { companyKey } from './payload';

/**
 * What the person did with earlier recommended roles, read back into the next
 * search (job_search 0039).
 *
 * Saving a role says "more like this"; turning one down says why not. The
 * search is told both, the newest first, and a posting turned down for its
 * company keeps that company out of every later search, checked after the
 * call as the excluded industries are. Pure, so the prompt's lists are tested
 * apart from the model.
 */

export const DISMISS_REASONS = ['level', 'location', 'work', 'company', 'pay', 'closed', 'seen', 'other'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

/** As the Not for me menu offers them. */
export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  level: 'Wrong level',
  location: 'Wrong location or workplace',
  work: 'Not the work I want',
  company: 'Not this company',
  pay: 'Pay too low',
  closed: 'Posting closed',
  seen: 'Already seen it',
  other: 'Something else',
};

/** As the search reads them, after the role. */
const REASON_FOR_SEARCH: Record<DismissReason, string> = {
  level: 'wrong level',
  location: 'wrong location or workplace',
  work: 'not the kind of work they want',
  company: 'they do not want this company',
  pay: 'pay too low',
  closed: 'the posting had closed',
  seen: 'they had already seen it',
  other: 'no reason given',
};

export function isDismissReason(value: unknown): value is DismissReason {
  return typeof value === 'string' && (DISMISS_REASONS as readonly string[]).includes(value);
}

/** An earlier role suggestion as the feedback reads it, newest first. */
export type PastOpening = {
  status: string;
  headline: string | null;
  companyName: string | null;
  dismissReason: string | null;
};

export type OpeningFeedback = {
  /** "Title at Company", for roles they saved. */
  saved: string[];
  /** "Title at Company (reason)", for roles they turned down. */
  dismissed: string[];
  /** companyKey of every company turned down for being that company. */
  companies: Set<string>;
};

/** How many of each list the search reads. Enough to show a pattern. */
export const FEEDBACK_LIMIT = 30;

function label(row: PastOpening): string | null {
  if (!row.headline) return null;
  return row.companyName ? `${row.headline} at ${row.companyName}` : row.headline;
}

/**
 * The saved and turned-down roles, newest first. A dismissal with no reason
 * (from before reasons were asked) still counts, as "no reason given"; one
 * Dash made itself (a closed or duplicate posting) has status expired and is
 * not the person's judgement, so it is left out.
 */
export function openingFeedback(rows: readonly PastOpening[]): OpeningFeedback {
  const saved: string[] = [];
  const dismissed: string[] = [];
  const companies = new Set<string>();
  for (const row of rows) {
    const text = label(row);
    if (row.status === 'done' && text && saved.length < FEEDBACK_LIMIT) saved.push(text);
    if (row.status === 'dismissed') {
      const reason = isDismissReason(row.dismissReason) ? row.dismissReason : 'other';
      if (reason === 'company' && row.companyName) {
        const key = companyKey(row.companyName);
        if (key) companies.add(key);
      }
      if (text && dismissed.length < FEEDBACK_LIMIT) dismissed.push(`${text} (${REASON_FOR_SEARCH[reason]})`);
    }
  }
  return { saved, dismissed, companies };
}
