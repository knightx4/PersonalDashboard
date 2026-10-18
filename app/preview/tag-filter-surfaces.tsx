import { PageHeader } from '@/components/shell/page-header';
import { AimButton } from '@/components/shell/aim-button';
import { AgendaPiles } from '@/components/todo/agenda-piles';
import { TagFilterEmpty, TagFilterRow } from '@/components/todo/tag-filter';
import type { AgendaEntry, AgendaPile } from '@/lib/todo/agenda/merge';
import type { Task } from '@/lib/todo/tasks/model';
import { filterPiles, type TagFilter } from '@/lib/todo/tasks/tag-filter';

/**
 * The agenda narrowed by a tag (plan #2340.3). The piles below are the whole
 * agenda, appointment included, put through the same filterPiles the page
 * uses, so the picture is what the filter really leaves: the Now todos in
 * their usual sections, and nothing from the calendar.
 */

const TZ = 'Europe/London';

/** The person's tags, most used first, as loadUsedTags reads them. */
const USED = ['now', 'home', 'eventually', 'errands', 'car', 'landlord-and-letting-agent-paperwork'];

function task(id: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    body: null,
    status: 'open',
    dueOn: null,
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: '2026-10-09T08:00:00.000Z',
    position: null,
    parentId: null,
    tags: [],
    ...extra,
  };
}

function entry(t: Task): AgendaEntry {
  return { kind: 'task', key: `task:${t.id}`, task: t, children: [], openChildren: 0, totalChildren: 0 };
}

const PILES: AgendaPile[] = [
  {
    bucket: 'overdue',
    entries: [entry(task('t1', 'Pay the council tax bill', { dueOn: '2026-10-14', tags: ['home', 'now'] }))],
    context: [],
  },
  {
    bucket: 'today',
    entries: [
      entry(task('t2', 'Ring the garage about the MOT', { dueOn: '2026-10-18', tags: ['car', 'now'] })),
      entry(task('t3', 'Return the kettle', { dueOn: '2026-10-18' })),
    ],
    context: [
      {
        key: 'c1',
        ref: 'todo.events:e1',
        day: '2026-10-18',
        at: '2026-10-18T14:00:00.000Z',
        label: 'Dentist',
        detail: null,
        link: null,
      },
    ],
  },
  {
    bucket: 'undated',
    entries: [
      entry(
        task(
          't4',
          'Write to the letting agent about the damp in the back bedroom before the inspection',
          { tags: ['landlord-and-letting-agent-paperwork', 'now'] },
        ),
      ),
      entry(task('t5', 'Learn to make sourdough', { tags: ['eventually'] })),
    ],
    context: [],
  },
];

function Header() {
  return <PageHeader title="Agenda" actions={<AimButton aim={{ kind: 'todo' }} label="Add a todo" />} />;
}

export function AgendaTaggedSurface() {
  const filter: TagFilter = { kind: 'tag', tag: 'now' };
  return (
    <>
      <Header />
      <TagFilterRow pathname="/todo" used={USED} filter={filter} className="mt-6" />
      <AgendaPiles
        piles={filterPiles(PILES, filter)}
        timezone={TZ}
        working={[]}
        threads={new Map()}
        files={new Map()}
        className="mt-6"
      />
    </>
  );
}

/**
 * The phone's More menu held open, a hidden part of the row: the tags that
 * did not fit, and Untagged. The row only has a More on a phone, so the
 * laptop shots show the full row instead.
 */
export function AgendaTaggedMoreSurface() {
  const filter: TagFilter = { kind: 'tag', tag: 'now' };
  return (
    <>
      <Header />
      <TagFilterRow pathname="/todo" used={USED} filter={filter} menuOpen className="mt-6" />
      <AgendaPiles
        piles={filterPiles(PILES, filter)}
        timezone={TZ}
        working={[]}
        threads={new Map()}
        files={new Map()}
        className="mt-6"
      />
    </>
  );
}

export function AgendaTaggedEmptySurface() {
  const filter: TagFilter = { kind: 'tag', tag: 'errands' };
  return (
    <>
      <Header />
      <TagFilterRow pathname="/todo" used={USED} filter={filter} className="mt-6" />
      <TagFilterEmpty filter={filter} clearHref="/todo" className="mt-6" />
    </>
  );
}
