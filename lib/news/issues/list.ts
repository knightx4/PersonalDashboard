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

/**
 * Where back goes from an opened issue, and what it is called.
 *
 * Back went to the sender's own filtered list every time, because that is the
 * one thing the issue knows about itself. Opening something from the whole
 * list and being put down inside a filter you were never in is not going back
 * -- note 71889d79. The list is either everything or one sender's, and nothing
 * on the issue can tell which of the two you came from, so the list says so by
 * carrying `from` onto the link it draws.
 *
 * `from` is honoured only when it names this issue's own sender. That is the
 * only filter an issue can be reached through -- a sender's list holds that
 * sender's issues -- so anything else is a hand-written address, and the
 * whole list is the honest answer to it.
 *
 * The filter comes back out as `from` so the issue's own links can keep it:
 * asking for the pictures reloads this page, and it should not be the press
 * that loses where you were.
 */
export function issueReturn(
  from: string | undefined,
  sender: NewsSender | null,
): { href: string; label: string; from: string | null } {
  if (from && sender && from === sender.id) {
    return { href: `/news?from=${sender.id}`, label: senderLabel(sender), from: sender.id };
  }
  return { href: '/news', label: 'Newsletters', from: null };
}
