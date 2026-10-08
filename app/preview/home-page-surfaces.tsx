import { AppShell } from '@/components/shell/app-shell';
import { DayBrief } from '@/app/home/day-brief';
import {
  BriefLine,
  HomeColumns,
  HomeHeader,
  TodayCard,
  UpdatesCard,
  WeekCard,
  WorkspaceList,
  WorkspaceMarks,
  type WorkspaceEntry,
} from '@/app/home/home-view';
import type { Update } from '@/lib/shell/home-model';
import type { Brief } from '@/lib/shell/brief';
import type { ModuleId } from '@/lib/modules';
import { WatchingSurface } from './watching-surfaces';
import { DashTodaySurface } from './dash-today-surfaces';

/**
 * Home as a whole page (plan #1627), inside the shell, so the critic sees the
 * main column and the rail side by side at 1280 and the order they fall into
 * at 390. Every section is the component the page draws, with fixtures; the
 * Watching and Dash today sections reuse their own surfaces' fixtures.
 */

const TZ = 'Europe/London';
const NOW = new Date('2026-10-06T15:10:00Z');

const WORKSPACES: WorkspaceEntry[] = [
  { id: 'jobs', label: 'Job search', href: '/jobs', stat: '3 to review' },
  { id: 'todo', label: 'Todo', href: '/todo', stat: '8 open, 2 overdue' },
  { id: 'shopping', label: 'Shopping', href: '/shopping', stat: '1 return due' },
  { id: 'goals', label: 'Goals', href: '/goals', stat: '4 steps waiting on you' },
  { id: 'learn', label: 'Learn', href: '/learn', stat: '2 cards due' },
  { id: 'news', label: 'News', href: '/news', stat: '14 unread issues across 6 newsletters' },
  { id: 'vault', label: 'Vault', href: '/vault', stat: 'Your notes, searchable' },
];

const BRIEFS: [ModuleId, Brief][] = [
  ['jobs', { text: 'Northwind Health replied about the staff engineer role', href: '/jobs/review', tone: 'caution' }],
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

export function HomePageSurface() {
  return (
    <AppShell
      account="preview"
      module={null}
      sections={[]}
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
        header={
          <HomeHeader
            greeting="Good afternoon, Chris"
            date="Tuesday 6 October"
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
          />
        }
        main={
          <>
            <WorkspaceMarks workspaces={WORKSPACES} />
            <ul className="mt-2 divide-y divide-border">
              {BRIEFS.map(([module, brief]) => (
                <BriefLine key={module} module={module} brief={brief} />
              ))}
            </ul>
            <TodayCard
              timezone={TZ}
              more={3}
              happening={[
                {
                  key: 'h1',
                  at: '2026-10-06T15:30:00Z',
                  label: 'Interview: Northwind Health',
                  detail: 'Video call, 60 min',
                  href: '/jobs/roles/r1',
                },
              ]}
              due={[
                { key: 'd1', overdue: true, title: 'Send the signed tenancy form back to the agent', href: '/todo' },
                { key: 'd2', overdue: true, title: 'Renew the car insurance', href: '/todo' },
                { key: 'd3', overdue: false, title: 'Book the dentist', href: '/todo' },
                { key: 'd4', overdue: false, title: 'Return the Uniqlo jacket that did not fit', href: '/shopping' },
                { key: 'd5', overdue: false, title: 'Pay Sam back for the concert tickets', href: '/todo' },
              ]}
            />
            <UpdatesCard updates={UPDATES} now={NOW} timezone={TZ} />
          </>
        }
        rail={
          <>
            <WatchingSurface />
            <DashTodaySurface />
            <WeekCard
              timezone={TZ}
              rows={[
                { key: 'w1', day: '2026-10-07', at: '2026-10-07T18:00:00Z', label: 'Reading group', detail: 'The Pinch', href: '/todo', booked: true },
                { key: 'w2', day: '2026-10-08', at: null, label: 'Uniqlo return window closes', detail: null, href: '/shopping', booked: false },
                { key: 'w3', day: '2026-10-09', at: null, label: 'Take-home for Monzo due', detail: null, href: '/jobs', booked: false },
                { key: 'w4', day: '2026-10-10', at: '2026-10-10T08:30:00Z', label: 'Dentist', detail: 'Check-up', href: '/todo', booked: true },
                { key: 'w5', day: '2026-10-12', at: null, label: 'Council tax', detail: null, href: '/todo', booked: false },
              ]}
            />
            <WorkspaceList workspaces={WORKSPACES} />
          </>
        }
      />
    </AppShell>
  );
}
