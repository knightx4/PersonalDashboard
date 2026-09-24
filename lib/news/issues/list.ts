import { safeTimeZone } from '@/lib/core/timezone';
import { readStories } from './stories';
import { NEWS_TOPICS, type NewsTopic } from './topics';

/** One newsletter in the list. The body is not read until you open it. */
export type NewsIssue = {
  id: string;
  senderId: string;
  subject: string | null;
  receivedAt: string;
  readAt: string | null;
  /**
   * The one-line summary Haiku wrote for the list (#824), or null while the
   * issue has not been summarised or its summary failed. The list draws it
   * under the sender and draws nothing extra without it (#825).
   */
  summaryLine: string | null;
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
export function visibleIssues<T extends { senderId: string }>(
  issues: readonly T[],
  senders: readonly NewsSender[],
  senderId: string | null,
): T[] {
  if (senderId) return issues.filter((issue) => issue.senderId === senderId);
  const muted = new Set(senders.filter((sender) => sender.muted).map((sender) => sender.id));
  return issues.filter((issue) => !muted.has(issue.senderId));
}

/** An unread newsletter's stories as stored, for the list's topic chips. */
export type UnreadStories = { senderId: string; stories: unknown };

/**
 * The topics the list offers as chips (plan #860), in NEWS_TOPICS order: every
 * topic carried by a story in an unread newsletter the list would draw, under
 * the same sender and muting rules as visibleIssues. A topic with nothing
 * unread gets no chip.
 */
export function unreadTopics(
  unread: readonly UnreadStories[],
  senders: readonly NewsSender[],
  senderId: string | null,
): NewsTopic[] {
  const found = new Set<NewsTopic>();
  for (const issue of visibleIssues(unread, senders, senderId)) {
    for (const story of readStories(issue.stories)) {
      if (story.topic) found.add(story.topic);
    }
  }
  return NEWS_TOPICS.filter((topic) => found.has(topic));
}

/**
 * The list's address with its filters on it: one sender, one topic, both or
 * neither. Each link on the list that changes one filter keeps the other.
 */
export function listHref({
  from,
  topic,
  view = 'latest',
}: {
  from: string | null;
  topic: NewsTopic | null;
  view?: ListView;
}): string {
  const query = new URLSearchParams();
  if (view === 'newsletters') query.set('view', 'newsletters');
  if (from) query.set('from', from);
  if (topic) query.set('topic', topic);
  const search = query.toString();
  return search ? `/news/all?${search}` : '/news/all';
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
 * turning the pictures off reloads this page, and it should not be the press
 * that loses where you were.
 */
export function issueReturn(
  from: string | undefined,
  sender: NewsSender | null,
): { href: string; label: string; from: string | null } {
  if (from && sender && from === sender.id) {
    return { href: `/news/all?from=${sender.id}`, label: senderLabel(sender), from: sender.id };
  }
  return { href: '/news/all', label: 'Newsletters', from: null };
}

/**
 * The address of an issue with the reader's choices on it.
 *
 * Every link on the issue page that reloads it goes through here, so each one
 * keeps the choices it does not change: asking for the pictures keeps you on
 * the original email, and switching between the summary and the original
 * keeps the pictures setting and the list you came from. The choices are
 * query parameters so that none of this needs script on the page.
 *
 * Pictures are on unless turned off, so only `pictures=0` is ever written.
 */
export function issueHref(
  id: string,
  { original, pictures, from }: { original: boolean; pictures: boolean; from: string | null },
): string {
  const query = new URLSearchParams();
  if (original) query.set('view', 'original');
  if (!pictures) query.set('pictures', '0');
  if (from) query.set('from', from);
  const search = query.toString();
  return search ? `/news/i/${id}?${search}` : `/news/i/${id}`;
}

/**
 * The two ways the list is read (note 20a58f93): every issue newest first, or
 * one row per newsletter that opens onto that newsletter's editions.
 */
export type ListView = 'latest' | 'newsletters';

export function readListView(value: string | undefined): ListView {
  return value === 'newsletters' ? 'newsletters' : 'latest';
}

/** One newsletter in the by-newsletter view, with what it has sent. */
export type NewsletterRow = {
  sender: NewsSender;
  editions: number;
  unread: number;
  latest: NewsIssue;
};

/**
 * One row per sender that has an issue in the list, the one that wrote most
 * recently first, so the by-newsletter view still opens on what is new.
 * Muted senders are listed as well: picking one is how their issues are read,
 * the same as in the sender column.
 */
export function newsletterRows(
  issues: readonly NewsIssue[],
  senders: readonly NewsSender[],
): NewsletterRow[] {
  const byId = new Map(senders.map((sender) => [sender.id, sender]));
  const rows = new Map<string, NewsletterRow>();
  for (const issue of issues) {
    const sender = byId.get(issue.senderId);
    if (!sender) continue;
    const row = rows.get(sender.id);
    if (!row) {
      rows.set(sender.id, { sender, editions: 1, unread: issue.readAt ? 0 : 1, latest: issue });
      continue;
    }
    row.editions += 1;
    if (!issue.readAt) row.unread += 1;
    if (issue.receivedAt > row.latest.receivedAt) row.latest = issue;
  }
  return [...rows.values()].sort((a, b) => b.latest.receivedAt.localeCompare(a.latest.receivedAt));
}
