import { classificationLabel, type ReviewRow } from '@/lib/jobs/review/load';

/**
 * The review queue as a strip on Today (decision #1586, plan #1591): how many
 * imports are waiting to be checked and the first few of them, newest first.
 * The queue page keeps the rest and is one press away; it has left the tab
 * bar.
 *
 * Pure.
 */

/** How many of the waiting imports the strip names. */
export const REVIEW_PEEK_LIMIT = 3;

export interface ReviewPeekItem {
  id: string;
  /** What arrived: the email's subject, or the role it is about. */
  title: string;
  /** What kind of thing it is, in a few words. */
  kind: string;
}

export interface ReviewPeek {
  count: number;
  items: ReviewPeekItem[];
}

function itemOf(row: ReviewRow): ReviewPeekItem {
  if (row.kind === 'message') {
    return {
      id: row.id,
      title: row.subject?.trim() || row.fromAddress || 'An email with no subject',
      kind: `${classificationLabel(row.classification)} email`,
    };
  }
  const title = `${row.companyName} · ${row.roleTitle}`;
  if (row.kind === 'application') {
    return { id: row.id, title, kind: 'New application from mail' };
  }
  return { id: row.id, title, kind: 'Mail after it closed' };
}

/** The rows come from loadReviewQueue, already newest first. */
export function reviewPeek(rows: readonly ReviewRow[], limit = REVIEW_PEEK_LIMIT): ReviewPeek {
  return { count: rows.length, items: rows.slice(0, limit).map(itemOf) };
}
