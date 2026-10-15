'use client';

import type { InboxRow, InboxWrite } from '@/components/inbox/inbox-page';
import { HomeInboxView, type HomeInboxViewGroup } from '@/components/inbox/home-inbox';
import { JOBS, SHOPPING, TODO } from './workspace-inbox-surfaces';

/**
 * Home's Inbox (plan #1937.7): every workspace's on-you rows, a group to each
 * workspace under its mark. Shopping, Jobs and Todo reuse their own Inboxes'
 * fixtures; Goals and Dev show the rows the agenda brings from them, a goal's
 * flag and an open raise, which used to be the bell's whole list.
 */

const write = (message: string): InboxWrite => ({ action: async () => ({ message }), fields: {} });
const later = write('Later.');
const decline = write('Declined.');
const onYou = { state: 'on_you' as const };

const GOALS: InboxRow[] = [
  {
    ref: 'public.raised_items:g1',
    section: 'actions',
    title: 'Running a half marathon looks off track: three weeks without a logged run',
    line: 'Dash flagged it on the goal',
    href: '/goals/g1',
    move: onYou,
    later,
    verbs: [{ label: 'The goal', tone: 'primary', href: '/goals/g1' }],
    decline,
  },
];

const DEV: InboxRow[] = [
  {
    ref: 'public.raised_items:r1',
    section: 'actions',
    title: 'Set the Vercel token so the overnight runner can read deploys',
    line: 'Asked Mon 13 Oct',
    href: '/dev/inbox#raise-r1',
    move: onYou,
    later,
    verbs: [{ label: 'Dash', tone: 'primary', href: '/dev/inbox#raise-r1' }],
    decline,
  },
  {
    ref: 'public.plan_items:p1',
    section: 'questions',
    title: 'Which shape for the export?',
    line: 'Plan #1940.2',
    href: '/dev/plan',
    move: onYou,
    later,
    verbs: [{ label: 'Answer', tone: 'primary', href: '/dev/plan' }],
    decline,
  },
];

const GROUPS: HomeInboxViewGroup[] = [
  { workspace: 'shopping', label: 'Shopping', href: '/shopping/inbox', rows: SHOPPING.slice(0, 3) },
  { workspace: 'jobs', label: 'Job search', href: '/jobs/inbox', rows: JOBS },
  { workspace: 'todo', label: 'Todo', href: '/todo/inbox', rows: TODO.slice(0, 2) },
  { workspace: 'goals', label: 'Goals', href: '/goals/inbox', rows: GOALS },
  { workspace: 'dev', label: 'Dev', href: '/dev/inbox', rows: DEV },
];

export function HomeInboxSurface() {
  return <HomeInboxView groups={GROUPS} />;
}
