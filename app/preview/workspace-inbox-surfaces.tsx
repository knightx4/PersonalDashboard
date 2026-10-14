'use client';

import type { InboxRow, InboxWrite } from '@/components/inbox/inbox-page';
import { WorkspaceInbox } from '@/components/inbox/workspace-inbox';
import { queueRow } from '@/lib/inbox/queue-rows';

/**
 * Each workspace's Inbox (plan #1937.5), drawn from rows shaped as the
 * agenda makes them (lib/inbox/agenda-rows.ts): a queue row where the
 * workspace keeps one, then its on-you rows with the verbs their sources
 * have. News is drawn empty, as it mostly is, so the empty state is seen.
 */

const write = (message: string): InboxWrite => ({ action: async () => ({ message }), fields: {} });
const done = { label: 'Done', tone: 'primary' as const, write: write('Done.') };
const putOff = write('Put off for now.');
const decline = write('Declined.');
const onYou = { state: 'on_you' as const };

const queue = (row: InboxRow | null): InboxRow[] => (row ? [row] : []);

const SHOPPING: InboxRow[] = [
  ...queue(queueRow('shopping-review', 4)),
  {
    ref: 'public.orders:o1',
    section: 'actions',
    title: 'Return window closes: Bosch cordless drill and the spare battery pack',
    line: 'Screwfix · was due Mon 13 Oct',
    href: '/shopping/orders/o1',
    move: onYou,
    putOff,
    verbs: [{ label: 'Returns', tone: 'primary', href: '/shopping/returns' }],
    decline,
  },
  {
    ref: 'core.drafted_messages:d1',
    section: 'actions',
    title: 'Ask Argos for a refund on the kettle',
    line: 'The window closes in four days · due today',
    href: '/shopping/orders/o2',
    move: onYou,
    putOff,
    verbs: [done, { label: 'Send in Gmail', tone: 'secondary', href: '#' }],
    decline,
  },
  {
    ref: 'public.recurring_payments:p1',
    section: 'actions',
    title: 'Council tax',
    line: '£148.00 · due Sat 18 Oct',
    href: '/shopping/recurring',
    move: onYou,
    putOff,
    verbs: [{ label: 'Open Recurring', tone: 'primary', href: '/shopping/recurring' }],
    decline,
  },
];

const JOBS: InboxRow[] = [
  ...queue(queueRow('jobs-review', 2)),
  {
    ref: 'job_search.reminders:r1',
    section: 'actions',
    title: 'Follow up with Monzo about the Senior Product Designer role',
    line: 'No reply in three weeks · was due Fri 10 Oct',
    href: '/jobs/roles/r1',
    move: onYou,
    putOff,
    verbs: [done, { label: 'Write the follow-up', tone: 'secondary', href: '/jobs/roles/r1' }],
  },
  {
    // Mail waiting on a reply (plan #1937.9): the request as the title, the
    // role under it.
    ref: 'job_search.application_events:e1',
    section: 'actions',
    title: 'Asked for two or three times next week for a call with the hiring manager',
    line: 'Wise · Senior Product Designer, Card Payments',
    href: '/jobs/roles/r2',
    move: onYou,
    putOff,
    verbs: [done],
    decline,
  },
  {
    ref: 'job_search.applications:a4',
    section: 'actions',
    title: 'Do the Starling assessment',
    href: '/jobs/roles/r4',
    move: onYou,
    putOff,
    verbs: [{ label: 'Product Designer', tone: 'primary', href: '/jobs/roles/r4' }],
    decline,
  },
  {
    ref: 'job_search.roles:r3',
    section: 'questions',
    title: 'Is the Lead Designer role at Octopus still worth applying for?',
    line: 'Dash asked on the role',
    href: '/jobs/roles/r3',
    move: onYou,
    putOff,
    verbs: [{ label: 'Reply', tone: 'primary', href: '/jobs/roles/r3' }],
    decline,
  },
];

const TODO: InboxRow[] = [
  {
    ref: 'todo.tasks:t1',
    section: 'actions',
    title: 'Book the boiler service before the first cold week of the winter',
    line: '1 of 3 left',
    move: onYou,
    putOff,
    verbs: [done],
  },
  {
    ref: 'todo.tasks:t2',
    section: 'actions',
    title: 'Sort the loft',
    move: onYou,
    putOff,
    verbs: [done],
  },
  {
    ref: 'todo.tasks:t3',
    section: 'questions',
    title: 'Which hardware shop did you mean for the hinges?',
    line: 'Dash asked on Buy hinges for the shed door',
    href: '/todo',
    move: onYou,
    putOff,
    verbs: [{ label: 'Reply', tone: 'primary', href: '/todo' }],
    decline,
  },
];

const VAULT: InboxRow[] = [
  ...queue(queueRow('vault-triage', 3)),
  {
    ref: 'obsidian.notes:n1',
    section: 'questions',
    title: 'Should the lease scan go under Home or Money?',
    line: 'Dash asked on Lease 2026',
    href: '/vault/n/Inbox/Lease%202026',
    move: onYou,
    putOff,
    verbs: [{ label: 'Reply', tone: 'primary', href: '/vault/n/Inbox/Lease%202026' }],
    decline,
  },
];

const LEARN: InboxRow[] = [
  ...queue(queueRow('learn-read-now', 5)),
  {
    ref: 'learn.concepts:c1',
    section: 'questions',
    title: 'Do you want the spaced repetition cards for this one, or only the summary?',
    line: 'Dash asked on Bayesian updating',
    href: '/learn/c/c1',
    move: onYou,
    putOff,
    verbs: [{ label: 'Reply', tone: 'primary', href: '/learn/c/c1' }],
    decline,
  },
];

export function ShoppingInboxSurface() {
  return <WorkspaceInbox workspace="shopping" rows={SHOPPING} />;
}

export function JobsInboxSurface() {
  return <WorkspaceInbox workspace="jobs" rows={JOBS} />;
}

export function TodoInboxSurface() {
  return <WorkspaceInbox workspace="todo" rows={TODO} />;
}

export function VaultInboxSurface() {
  return <WorkspaceInbox workspace="vault" rows={VAULT} />;
}

export function LearnInboxSurface() {
  return <WorkspaceInbox workspace="learn" rows={LEARN} />;
}

export function NewsInboxSurface() {
  return <WorkspaceInbox workspace="news" rows={[]} />;
}
