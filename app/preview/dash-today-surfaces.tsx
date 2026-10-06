'use client';

import { DashTodaySection } from '@/app/home/dash-today';
import type { DashTodayEntry, DashTodayGroup } from '@/lib/shell/dash-today';

/**
 * Home's "What Dash did today" (plan #1461) in the surface gallery, with a
 * todo Dash added from a comment on a role linked back to that role (plan
 * #1518), one change already undone, one with no Undo, and a Dev group long
 * enough to fold.
 */

function entry(id: number, over: Partial<DashTodayEntry>): DashTodayEntry {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    surface: 'routine',
    status: 'done',
    sentence: '',
    href: null,
    at: '2026-10-06T14:00:00Z',
    workspace: null,
    noUndo: null,
    from: null,
    ...over,
  };
}

const GROUPS: DashTodayGroup[] = [
  {
    workspace: 'todo',
    label: 'Todo',
    entries: [
      entry(1, {
        surface: 'thread',
        workspace: 'todo',
        sentence: 'Added the todo Follow up with the hiring manager at Northwind Health about the staff engineer role.',
        href: '/todo?task=t1',
        at: '2026-10-06T15:42:00Z',
        from: '/jobs/roles/r1',
      }),
      entry(2, {
        surface: 'ask',
        status: 'undone',
        workspace: 'todo',
        sentence: 'Added the todo Buy stamps.',
        href: '/todo?task=t2',
        at: '2026-10-06T11:05:00Z',
      }),
    ],
  },
  {
    workspace: 'jobs',
    label: 'Jobs',
    entries: [
      entry(3, {
        surface: 'thread',
        workspace: 'jobs',
        sentence: 'Wrote the cover letter for Staff Engineer at Northwind Health.',
        href: '/jobs/applications/a1',
        at: '2026-10-06T15:40:00Z',
        from: '/jobs/roles/r1',
      }),
    ],
  },
  {
    workspace: 'dev',
    label: 'Dev',
    entries: [11, 10, 9, 8, 7, 6].map((n) =>
      entry(n, {
        workspace: 'dev',
        sentence: `Dash closed step #${1500 + n}.`,
        href: `/dev/plan#${1500 + n}`,
        at: `2026-10-06T${String(n).padStart(2, '0')}:30:00Z`,
        noUndo: n === 9 ? 'A closed step goes back by reopening it on the plan.' : null,
      }),
    ),
  },
];

export function DashTodaySurface() {
  return (
    <DashTodaySection
      groups={GROUPS}
      timezone="America/New_York"
      undo={async () => ({ ok: true })}
    />
  );
}
