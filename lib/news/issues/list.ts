import { safeTimeZone } from '@/lib/core/timezone';

/** One newsletter in the list. The body is not read until you open it. */
export type NewsIssue = {
  id: string;
  senderId: string;
  subject: string | null;
  receivedAt: string;
  readAt: string | null;
};

/** Who has written to your address. */
export type NewsSender = {
  id: string;
  email: string;
  name: string | null;
  muted: boolean;
};

/** What a sender is called: the name it gave, or the address it wrote from. */
export function senderLabel(sender: NewsSender): string {
  return sender.name ?? sender.email;
}

/** Senders in the order the column lists them: by what they are called. */
export function sortSenders(senders: readonly NewsSender[]): NewsSender[] {
  return [...senders].sort((a, b) =>
    senderLabel(a).localeCompare(senderLabel(b), 'en', { sensitivity: 'base' }),
  );
}

/**
 * Which issues the list draws.
 *
 * Two rules. Picking a sender shows that sender and nothing else. Otherwise a
 * muted sender's issues are left out -- muting is how a newsletter you have
 * stopped reading gets out of the way without being deleted, and its issues
 * are still there under its own name in the column.
 *
 * Issues arrive newest first from the query and stay in that order.
 */
export function visibleIssues(
  issues: readonly NewsIssue[],
  senders: readonly NewsSender[],
  senderId: string | null,
): NewsIssue[] {
  if (senderId) return issues.filter((issue) => issue.senderId === senderId);
  const muted = new Set(senders.filter((sender) => sender.muted).map((sender) => sender.id));
  return issues.filter((issue) => !muted.has(issue.senderId));
}

/**
 * When it arrived, in the account's own timezone.
 *
 * The day and the hour, because the list is read as a feed: a newsletter that
 * came this morning and one that came last Tuesday are different things, and
 * the day alone makes the morning's arrival look like yesterday's news.
 */
export function formatArrival(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: safeTimeZone(timezone),
  }).format(date);
}

/** "3 newsletters", and "1 newsletter" rather than "1 newsletters". */
export function countLabel(total: number): string {
  return `${total} ${total === 1 ? 'newsletter' : 'newsletters'}`;
}
