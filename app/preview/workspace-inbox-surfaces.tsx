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
const later = { label: 'Later', tone: 'ghost' as const, write: write('Put off for now.') };
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
    verbs: [{ label: 'Open the order', tone: 'primary', href: '/shopping/orders/o1' }, { label: 'Returns', tone: 'secondary', href: '/shopping/returns' }, later],
    decline,
  },
  {
    ref: 'core.drafted_messages:d1',
    section: 'actions',
    title: 'Ask Argos for a refund on the kettle',
    line: 'The window closes in four days · due today',
    href: '/shopping/orders/o2',
    move: onYou,
    verbs: [done, { label: 'Open the order', tone: 'secondary', href: '/shopping/orders/o2' }, { label: 'Send in Gmail', tone: 'secondary', href: '#' }, later],
    decline,
  },
  {
    ref: 'public.recurring_payments:p1',
    section: 'actions',
    title: 'Council tax',
    line: '£148.00 · due Sat 18 Oct',
    href: '/shopping/recurring',
    move: onYou,
    verbs: [{ label: 'Open Recurring', tone: 'primary', href: '/shopping/recurring' }, later],
    decline,
  },
];

const JOBS: InboxRow[] = [
  ...queue(queueRow('jobs-review', 2)),
  {
    ref: 'job_search.reminders:r1',
    section: 'actions',
    title: 'Follow up with Monzo about the Senior Product Designer role',
    line: 'Applied three weeks ago with no reply · was due Fri 10 Oct',
    href: '/jobs/roles/r1',
    move: onYou,
    verbs: [done, { label: 'Monzo', tone: 'secondary', href: '/jobs/roles/r1' }, { label: 'Write the follow-up', tone: 'secondary', href: '/jobs/roles/r1' }, later],
  },
  {
    ref: 'job_search.applications:a2',
    section: 'actions',
    title: 'Reply to Wise about a second interview',
    line: 'They wrote on Tue 7 Oct',
    href: '/jobs/roles/r2',
    move: onYou,
    verbs: [{ label: 'Open the role', tone: 'primary', href: '/jobs/roles/r2' }, later],
    decline,
  },
  {
    ref: 'job_search.roles:r3',
    section: 'questions',
    title: 'Is the Lead Designer role at Octopus still worth applying for?',
    line: 'Dash asked on the role',
    href: '/jobs/roles/r3',
    move: onYou,
    verbs: [{ label: 'Reply', tone: 'primary', href: '/jobs/roles/r3' }, later],
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
    verbs: [done, later],
  },
  {
    ref: 'todo.tasks:t2',
    section: 'actions',
    title: 'Sort the loft',
    move: onYou,
    verbs: [done, later],
  },
  {
    ref: 'todo.tasks:t3',
    section: 'questions',
    title: 'Which hardware shop did you mean for the hinges?',
    line: 'Dash asked on Buy hinges for the shed door',
    href: '/todo',
    move: onYou,
    verbs: [{ label: 'Reply', tone: 'primary', href: '/todo' }, later],
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
    verbs: [{ label: 'Reply', tone: 'primary', href: '/vault/n/Inbox/Lease%202026' }, later],
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
    verbs: [{ label: 'Reply', tone: 'primary', href: '/learn/c/c1' }, later],
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
