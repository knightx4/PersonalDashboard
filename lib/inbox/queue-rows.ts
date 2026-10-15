import type { InboxRow } from '@/components/inbox/inbox-page';

/**
 * Queues as one Inbox row each (plan #1937.5): the mail sync's guesses in
 * Shopping and Jobs, the vault's quick notes, Learn's queued readings. Each
 * queue has its own page that works through it, so the Inbox does not list
 * the queue's rows; it says how many there are and opens the page.
 *
 * PURE, so the wording is tested.
 */

export type InboxQueue = 'shopping-review' | 'jobs-review' | 'vault-triage' | 'learn-read-now';

const QUEUES: Record<
  InboxQueue,
  {
    one: string;
    many: string;
    line: string;
    verb: string;
    href: string;
    section: InboxRow['section'];
  }
> = {
  'shopping-review': {
    one: '1 guess from your mail to check',
    many: '{n} guesses from your mail to check',
    line: 'Orders and emails the mail sync was not sure of',
    verb: 'Review',
    href: '/shopping/review',
    section: 'review',
  },
  'jobs-review': {
    one: '1 import from your mail to check',
    many: '{n} imports from your mail to check',
    line: 'Applications, messages and interviews the mail sync was not sure of',
    verb: 'Review',
    href: '/jobs/review',
    section: 'review',
  },
  'vault-triage': {
    one: '1 quick note to file',
    many: '{n} quick notes to file',
    line: 'Waiting in the Inbox folder',
    verb: 'File them',
    href: '/vault/triage',
    section: 'actions',
  },
  'learn-read-now': {
    one: '1 reading you queued',
    many: '{n} readings you queued',
    line: 'First on Now, in the order you queued them',
    verb: 'Read',
    href: '/learn/now',
    section: 'actions',
  },
};

/** The queue as a row, or null when it is empty. */
export function queueRow(queue: InboxQueue, count: number): InboxRow | null {
  if (count <= 0) return null;
  const q = QUEUES[queue];
  return {
    ref: `queue:${queue}`,
    section: q.section,
    title: count === 1 ? q.one : q.many.replace('{n}', String(count)),
    line: q.line,
    href: q.href,
    move: { state: 'on_you' },
    verbs: [{ label: count === 1 && queue === 'vault-triage' ? 'File it' : q.verb, tone: 'primary', href: q.href }],
  };
}
