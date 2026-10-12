import { DoneTodayCard } from '@/app/home/done-today';
import { GoalLogDone } from '@/app/goals/[goalId]/goal-log-done';
import type { FiledEntry } from '@/lib/goals/capture';
import type { DoneTodayList } from '@/lib/goals/done-today';

/**
 * The "What did you do?" box (plan #1740), on Home's Done today and on a
 * goal's Overview. Fixtures: one line filed as three changes (a step closed,
 * finished work added as a closed step, progress asking how far along), and
 * the day's list with a task, closed steps and progress; the card with
 * nothing done, closed and then pressed open; and a goal's card. The home-page
 * surface draws the same card in place.
 */

const CLEAN = 'Keep the apartment clean';

const FILED: { captureId: string; entries: FiledEntry[] }[] = [
  {
    captureId: 'c1',
    entries: [
      {
        kind: 'close',
        step_id: 's-kitchen',
        title: 'Clean the kitchen',
        goal_title: CLEAN,
        undone_at: null,
      },
      {
        kind: 'add',
        step_id: 's-laundry',
        title: 'Do the laundry',
        step_kind: 'mine',
        goal_title: CLEAN,
        done: true,
        undone_at: null,
      },
      {
        kind: 'progress',
        entry_id: 'e1',
        item_id: 's-closet',
        step_title: 'Sort the hall closet',
        goal_title: CLEAN,
        text: 'sorted the shoes',
        quantity: null,
        unit: null,
        happened_on: '2026-10-11',
        ask_estimate: true,
        undone_at: null,
      },
    ],
  },
];

export const DONE_TODAY: DoneTodayList = {
  lines: [
    { key: 'step:s-kitchen', kind: 'step', title: 'Clean the kitchen', detail: CLEAN, href: '/goals/g/s/s-kitchen', at: '2026-10-11T12:00:00Z' },
    { key: 'step:s-laundry', kind: 'step', title: 'Do the laundry', detail: CLEAN, href: '/goals/g/s/s-laundry', at: '2026-10-11T12:00:00Z' },
    { key: 'progress:e1', kind: 'progress', title: 'sorted the shoes', detail: 'Sort the hall closet', href: '/goals/g/s/s-closet', at: '2026-10-11T12:00:00Z' },
    { key: 'progress:e2', kind: 'progress', title: 'read two chapters of The Power Broker', detail: 'Read about how the city’s planning fights work', href: '/goals/g2', at: '2026-10-11T10:00:00Z' },
    { key: 'task:t1', kind: 'task', title: 'Send the signed tenancy form back to the agent', detail: 'Todo', href: '/todo', at: '2026-10-11T09:00:00Z' },
  ],
  more: 2,
};

export function LogDoneSurface() {
  return (
    <div className="space-y-6">
      <DoneTodayCard done={DONE_TODAY} logging initial={FILED} initialMessage="Filed as 3 changes." />
      <DoneTodayCard done={{ lines: [], more: 0 }} logging />
      <DoneTodayCard done={{ lines: [], more: 0 }} logging initialOpen />
      <GoalLogDone
        goalId="g"
        initial={[{ captureId: 'c2', entries: FILED[0]!.entries.slice(0, 2) }]}
      />
    </div>
  );
}
