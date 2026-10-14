'use client';

import { InboxPage, type InboxLaterRow, type InboxRow, type InboxWrite } from '@/components/inbox/inbox-page';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';

/**
 * The one Inbox component (plan #1937.4) drawn from the row shape alone, as a
 * workspace's Inbox will be: a question answered with a press, one answered
 * in words, a proposal to take or decline, a row back from Later with the
 * longest title a row gets, and two rows shut under Later (opened here so
 * they are photographed).
 */

/** Stands in for a server action: the press says it worked. */
const write = (message: string): InboxWrite => ({
  action: async () => ({ message }),
  fields: {},
});
const later = write('Moved to Later.');

const rows: InboxRow[] = [
  {
    ref: 'shopping.returns:r1',
    section: 'actions',
    title: 'Take the Bosch drill back to Screwfix',
    line: 'Shopping · the refund window closes Fri 17 Oct',
    href: '/shopping/returns',
    move: { state: 'on_you' },
    verbs: [
      { label: 'Done', tone: 'primary', write: write('Done.') },
      { label: 'Open', tone: 'ghost', href: '/shopping/returns' },
    ],
    later,
  },
  {
    ref: 'todo.tasks:t1',
    section: 'actions',
    title:
      'Renew the car insurance before the current policy with the old provider runs out on the last day of October',
    line: 'Todo · due Fri 31 Oct',
    href: '/todo',
    move: { state: 'on_you' },
    verbs: [{ label: 'Done', tone: 'primary', write: write('Done.') }],
    later,
    back: true,
  },
  {
    ref: 'shopping.purchases:p1',
    section: 'questions',
    title: 'Which pair of running shoes did you keep?',
    line: 'Shopping · from the Sports Direct order on 2 Oct',
    move: { state: 'on_you' },
    question: { ...write('Saved.'), options: ['UK 9', 'UK 9.5', 'Sent both back'] },
    later,
  },
  {
    ref: 'vault.notes:n1',
    section: 'questions',
    title: 'What should the scanned lease be filed as?',
    line: 'Vault · a quick note from Tuesday',
    move: { state: 'on_you' },
    question: write('Filed.'),
    later,
  },
  {
    ref: 'shopping.purchases:p2',
    section: 'review',
    title: 'Add the Waterstones order to your library?',
    line: 'Shopping · Dash read it from the order email',
    move: { state: 'on_you' },
    verbs: [{ label: 'Add it', tone: 'primary', write: write('Added.') }],
    decline: write('Declined.'),
  },
  {
    ref: 'learn.suggestions:s1',
    section: 'review',
    title: 'Start the Rust track on Exercism?',
    line: 'Learn · Dash suggested it for the systems goal',
    move: { state: 'on_you' },
    verbs: [{ label: 'Start it', tone: 'primary', write: write('Started.') }],
    decline: write('Declined.'),
    later,
  },
];

const put: InboxLaterRow[] = [
  {
    ref: 'todo.tasks:t2',
    title: 'Book the boiler service',
    line: 'Todo · back Mon 20 Oct',
    bringBack: write('Back on you.'),
  },
  {
    ref: 'jobs.roles:j1',
    title: 'Write to the hiring manager at the climate data start-up about the platform engineer role',
    line: 'Jobs · back Mon 27 Oct',
    bringBack: write('Back on you.'),
  },
];

export function InboxPageSurface() {
  return (
    <PageColumn className="space-y-6">
      <PageHeader title="Inbox" />
      <InboxPage
        rows={rows}
        later={put}
        laterOpen
        empty={{ title: 'Nothing waiting on you', description: 'What needs you lands here.' }}
      />
    </PageColumn>
  );
}
