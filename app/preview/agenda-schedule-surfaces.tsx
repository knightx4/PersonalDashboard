import { PageHeader } from '@/components/shell/page-header';
import { AimButton } from '@/components/shell/aim-button';
import { AgendaPiles } from '@/components/todo/agenda-piles';
import type { AgendaEntry, AgendaPile } from '@/lib/todo/agenda/merge';
import { scheduleContext } from '@/lib/todo/agenda/schedule-context';
import { foldSchedule, type ScheduleEntry } from '@/lib/todo/schedule/model';
import { addDays, todayIn, type Task } from '@/lib/todo/tasks/model';
import { zoneOffset } from '@/lib/core/when';

/**
 * The agenda's days drawn from the one schedule (plan #3027.1). The booked
 * rows go through the same foldSchedule and scheduleContext the page uses,
 * so the picture is what the fold really leaves: the dinner on your calendar
 * and in the Resy email once, saying where else it is; the interview whose
 * calendar copy says another hour, asking which is right; a weekend visit
 * running over three days; and a party from a subscribed calendar.
 */

const TZ = 'America/New_York';
// Dated from the day the gallery is shot, so "Today" and the todos' own
// dates agree with the clock the rows read.
const TODAY = todayIn(TZ);
const day = (offset: number) => addDays(TODAY, offset);

/** The instant of a wall-clock time on a day in TZ. */
function at(offset: number, clock: string): string {
  const naive = Date.parse(`${day(offset)}T${clock}:00.000Z`);
  return new Date(naive - zoneOffset(naive, TZ)).toISOString();
}

function booked(extra: Partial<ScheduleEntry> & Pick<ScheduleEntry, 'key' | 'source' | 'from' | 'title' | 'day'>): ScheduleEntry {
  return {
    kind: 'booked',
    ref: `todo.events:${extra.key}`,
    lastDay: extra.day,
    startsAt: null,
    endsAt: null,
    allDay: false,
    location: null,
    detail: null,
    href: `/todo/calendar?date=${extra.day}`,
    alsoIn: [],
    conflicts: [],
    ...extra,
  };
}

const ENTRIES: ScheduleEntry[] = foldSchedule([
  booked({
    key: 'own_event:visit',
    source: 'own_event',
    from: 'Your calendar',
    title: 'Mum and Dad visiting',
    day: day(-1),
    lastDay: day(2),
    allDay: true,
  }),
  booked({
    key: 'own_event:lilia',
    source: 'own_event',
    from: 'Your calendar',
    title: 'Dinner at Lilia',
    day: TODAY,
    startsAt: at(0, '20:00'),
  }),
  booked({
    key: 'appointment:lilia',
    source: 'appointment',
    from: 'Booking email',
    title: 'Dinner at Lilia',
    day: TODAY,
    startsAt: at(0, '20:00'),
    detail: 'Resy',
    location: '567 Union Ave, Brooklyn',
  }),
  booked({
    key: 'feed_event:party',
    source: 'feed_event',
    from: 'Partiful calendar',
    title: 'Housewarming at Priya and Tom’s new place in Fort Greene',
    day: day(1),
    startsAt: at(1, '14:00'),
  }),
  booked({
    key: 'interview:numeric',
    source: 'interview',
    from: 'Job interviews',
    title: 'Numeric · Implementation Lead',
    day: day(2),
    startsAt: at(2, '10:00'),
    detail: 'Round 2 · Video · 45 min',
    href: '/jobs/roles/r1?tab=interviews&interview=i1',
  }),
  booked({
    key: 'feed_event:numeric',
    source: 'feed_event',
    from: 'Google calendar',
    title: 'Numeric Implementation Lead interview',
    day: day(2),
    startsAt: at(2, '11:00'),
  }),
]);

const CONTEXT = scheduleContext(ENTRIES, TZ, TODAY);

function task(id: string, title: string, dueOn: string): AgendaEntry {
  const t: Task = {
    id,
    title,
    body: null,
    status: 'open',
    dueOn,
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: `${day(-5)}T08:00:00.000Z`,
    position: null,
    parentId: null,
    tags: [],
  };
  return { kind: 'task', key: `task:${id}`, task: t, children: [], openChildren: 0, totalChildren: 0 };
}

const PILES: AgendaPile[] = [
  {
    bucket: 'today',
    entries: [task('t1', 'Pick up flowers for Mum', TODAY), task('t2', 'Confirm the dinner booking for four', TODAY)],
    context: CONTEXT.filter((row) => row.day === TODAY),
  },
  {
    bucket: 'soon',
    entries: [task('t3', 'Read the Numeric case study before the second round', day(1))],
    context: CONTEXT.filter((row) => row.day > TODAY),
  },
];

export function AgendaScheduleSurface() {
  return (
    <>
      <PageHeader title="Agenda" actions={<AimButton aim={{ kind: 'todo' }} label="Add a todo" />} />
      <AgendaPiles
        piles={PILES}
        timezone={TZ}
        working={[]}
        threads={new Map()}
        files={new Map()}
        className="mt-6"
      />
    </>
  );
}
