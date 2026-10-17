import { AppShell } from '@/components/shell/app-shell';
import { DayBrief } from '@/app/home/day-brief';
import Link, { linkVariants } from '@/components/ui/link';
import {
  BriefLine,
  HomeColumns,
  HomeHeader,
  InboxLine,
  TodayList,
  UpdatesList,
  WeekList,
} from '@/app/home/home-view';
import { HomeFold } from '@/app/home/home-fold';
import type { Update } from '@/lib/shell/home-model';
import { HOME_SECTIONS } from '@/lib/home/sections';
import type { Brief } from '@/lib/shell/brief';
import type { ModuleId } from '@/lib/modules';
import { WATCHING_NOW, WATCHING_ROWS } from './watching-surfaces';
import { DashTodayFoldSurface } from './dash-today-surfaces';
import { WatchingList } from '@/app/home/watching';
import { DoneTodayBody, doneTodayCount } from '@/app/home/done-today';
import { DONE_TODAY } from './log-done-surfaces';

/**
 * Home as a whole page (plan #1627), inside the shell, so the critic sees the
 * main column and the rail side by side at 1280 and the order they fall into
 * at 390. Every section is the component the page draws, with fixtures; the
 * Watching and Dash today sections reuse their own surfaces' fixtures. Since
 * plan #1937.8 the main column is the greeting, the date, the briefs and the
 * Inbox count, and the rest is folds in the rail: open at 1280, shut at 390.
 */

const TZ = 'Europe/London';
const NOW = new Date('2026-10-06T15:10:00Z');

const BRIEFS: [ModuleId, Brief][] = [
  [
    'jobs',
    {
      text: 'Northwind Health replied about the staff engineer role',
      href: '/jobs/review',
      tone: 'caution',
    },
  ],
  ['todo', { text: 'Two things overdue, the longest since Friday', href: '/todo' }],
  ['shopping', { text: 'The Uniqlo return window closes on Thursday', href: '/shopping' }],
  ['goals', { text: 'Four steps on Move to Lisbon are waiting on you', href: '/goals' }],
];

const UPDATES: Update[] = [
  {
    key: 'u1',
    module: 'jobs',
    at: '2026-10-06T13:40:00Z',
    text: 'Northwind Health replied',
    detail: 'Staff Engineer, Platform: asked for times next week',
    href: '/jobs/roles/r1',
  },
  {
    key: 'u2',
    module: null,
    at: '2026-10-06T09:00:00Z',
    text: 'Stopped watching Floating Points at Printworks',
    detail: 'The event has passed. Lowest was £38, from £52.',
    href: null,
  },
  {
    key: 'u3',
    module: 'shopping',
    at: '2026-10-05T18:20:00Z',
    text: 'Order from Uniqlo shipped',
    detail: '2 items, arriving Wednesday',
    href: '/shopping/orders/o1',
  },
  {
    key: 'u4',
    module: 'news',
    at: '2026-10-05T07:10:00Z',
    text: 'Money Stuff, The Diff and 4 more newsletters',
    detail: null,
    href: '/news',
  },
];

const HAPPENING = [
  {
    key: 'h1',
    at: '2026-10-06T15:30:00Z',
    label: 'Interview: Northwind Health',
    detail: 'Video call, 60 min',
    href: '/jobs/roles/r1',
  },
];

const DUE = [
  {
    key: 'd1',
    overdue: true,
    title: 'Send the signed tenancy form back to the agent',
    href: '/todo',
  },
  { key: 'd2', overdue: true, title: 'Renew the car insurance', href: '/todo' },
  { key: 'd3', overdue: false, title: 'Book the dentist', href: '/todo' },
  {
    key: 'd4',
    overdue: false,
    title: 'Return the Uniqlo jacket that did not fit',
    href: '/shopping',
  },
  { key: 'd5', overdue: false, title: 'Pay Sam back for the concert tickets', href: '/todo' },
];

const WEEK = [
  {
    key: 'w1',
    day: '2026-10-07',
    at: '2026-10-07T18:00:00Z',
    label: 'Reading group',
    detail: 'The Pinch',
    href: '/todo',
    booked: true,
  },
  {
    key: 'w2',
    day: '2026-10-08',
    at: null,
    label: 'Uniqlo return window closes',
    detail: null,
    href: '/shopping',
    booked: false,
  },
  {
    key: 'w3',
    day: '2026-10-09',
    at: null,
    label: 'Take-home for Tallow due',
    detail: null,
    href: '/jobs',
    booked: false,
  },
  {
    key: 'w4',
    day: '2026-10-10',
    at: '2026-10-10T08:30:00Z',
    label: 'Dentist',
    detail: 'Check-up',
    href: '/todo',
    booked: true,
  },
  {
    key: 'w5',
    day: '2026-10-12',
    at: null,
    label: 'Council tax',
    detail: null,
    href: '/todo',
    booked: false,
  },
];

function AgendaLink() {
  return (
    <Link href="/todo" className={`press-area text-small ${linkVariants()}`}>
      The agenda
    </Link>
  );
}

export function HomePageSurface() {
  return (
    <AppShell
      account="preview"
      module={null}
      sections={HOME_SECTIONS}
      pathname="/home"
      displayName="Chris"
      email="chris@example.com"
      isOwner
      counts={{ jobs: '3', todo: '8', shopping: '1' }}
      theme={{ kind: 'written', id: 'paper' }}
      brief={null}
    >
      <HomeColumns
        arrive={false}
        remember={false}
        day="2026-10-06"
        header={<HomeHeader greeting="Good afternoon, Chris" date="Tuesday 6 October" />}
        brief={
          <DayBrief
            day="2026-10-06"
            brief={{
              kind: 'picks',
              picks: [
                {
                  key: 'p1',
                  kind: 'interview',
                  title: 'Second interview with Northwind Health at 4:30 PM',
                  reason: 'The system design round; your prep notes are on the role.',
                  href: '/jobs/roles/r1',
                },
                {
                  key: 'p2',
                  kind: 'reply',
                  title: 'Reply to Priya about the flat in Alfama',
                  reason: 'She asked on Saturday and the viewing slots go on Thursday.',
                  href: '/goals',
                },
              ],
            }}
          />
        }
        main={
          <>
            <ul className="divide-y divide-border">
              {BRIEFS.map(([module, brief]) => (
                <BriefLine key={module} module={module} brief={brief} />
              ))}
            </ul>
            <InboxLine count={7} />
          </>
        }
        rail={
          <>
            <HomeFold
              id="today"
              title="Today"
              count={HAPPENING.length + DUE.length + 3}
              action={<AgendaLink />}
            >
              <TodayList timezone={TZ} more={3} happening={HAPPENING} due={DUE} />
            </HomeFold>
            <HomeFold id="done-today" title="Done today" count={doneTodayCount(DONE_TODAY)}>
              <DoneTodayBody done={DONE_TODAY} logging />
            </HomeFold>
            <HomeFold id="watching" title="Watching" count={WATCHING_ROWS.length}>
              <WatchingList rows={WATCHING_ROWS} now={WATCHING_NOW} timezone="America/New_York" />
            </HomeFold>
            <DashTodayFoldSurface />
            <HomeFold id="week" title="This week" count={WEEK.length} action={<AgendaLink />}>
              <WeekList timezone={TZ} rows={WEEK} />
            </HomeFold>
            <HomeFold id="updates" title="Updates" count={UPDATES.length}>
              <UpdatesList updates={UPDATES} now={NOW} timezone={TZ} />
            </HomeFold>
          </>
        }
      />
    </AppShell>
  );
}
