import { createClient, requireUser } from '@/lib/auth/server';
import type { DevComment } from '@/lib/comments/load';
import { loadRowThreads } from '@/lib/thread/store';
import { THREAD_TABLES } from '@/lib/thread/subjects';
import { workingRefsForPage } from '@/lib/talk/handoffs';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { dayClosed, doneToday } from '@/lib/todo/agenda/day-close';
import { loadDoneSinceMidnight, loadUsedTags } from '@/lib/todo/tasks/load';
import { loadTaskFiles } from '@/lib/todo/tasks/files';
import { todayIn } from '@/lib/todo/tasks/model';
import { filterPiles, parseTagFilter } from '@/lib/todo/tasks/tag-filter';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { QueueCleared } from '@/components/motion/clear';
import { DayClosed } from '@/components/todo/day-closed';
import { AimButton } from '@/components/shell/aim-button';
import { AgendaPiles } from '@/components/todo/agenda-piles';
import { TagFilterEmpty, TagFilterRow } from '@/components/todo/tag-filter';
import { PageColumn } from '@/components/shell/page-width';
import { NowDashToday } from '@/components/shell/dash-today-fold';

export const metadata = { title: 'Agenda' };

/**
 * What has to happen.
 *
 * Piles rather than one flat list, and an empty pile is not shown at all: a
 * quiet week should look quiet. /jobs/today set that tone and it was right
 * there too.
 *
 * The tasks are this module's. Everything else on the page was read from
 * whichever workspace owns it, at the moment the page rendered, and is written
 * back to that workspace when you act on it. Nothing here is a copy.
 */
export default async function TodoPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string | string[]; untagged?: string | string[] }>;
}) {
  const user = await requireUser();
  // The tag filter (plan #2340.3), from the address so it survives a reload.
  const filter = parseTagFilter(await searchParams);
  const [agenda, working, used] = await Promise.all([
    loadAgenda(user.id),
    // What an Ask Dash hand-off is working on (plan #1568).
    workingRefsForPage(user.id),
    // The chips the filter offers. A failed read leaves Now and Eventually.
    loadUsedTags(user.id).catch(() => [] as string[]),
  ]);

  const empty = agenda.piles.length === 0;
  // The list narrowed to one tag, or to the untagged. The day closing and
  // the empty list still go by the whole agenda: a filter is a way of
  // looking, and the day is not finished because one tag is.
  const piles = filterPiles(agenda.piles, filter);

  // The day closing (plan #1556): what was due by today and has been
  // finished since midnight. A failed read leaves the day open rather than
  // the page broken; the list itself is still right.
  const now = new Date();
  const today = todayIn(agenda.timezone, now);
  const done = doneToday(
    await loadDoneSinceMidnight(user.id, agenda.timezone, now).catch(() => []),
    agenda.timezone,
    now,
  );
  const closed = dayClosed(agenda.piles, done);

  // The thread under each task on the agenda (plan #1471). A failed read
  // leaves them empty rather than the page broken.
  const taskIds = piles.flatMap(({ entries }) =>
    entries.flatMap((entry) => (entry.kind === 'task' && entry.task ? [entry.task.id] : [])),
  );
  // And the files each holds (plan #1714), read alongside.
  const [threads, files] = await Promise.all([
    createClient()
      .then((client) => loadRowThreads(client, THREAD_TABLES.task, taskIds, { userId: user.id }))
      .catch(() => new Map<string, DevComment[]>()),
    loadTaskFiles(taskIds),
  ]);

  return (
    <PageColumn>
      <PageHeader
        title="Agenda"
        actions={<AimButton aim={{ kind: 'todo' }} label="Add a todo" />}
        description={empty ? 'Nothing on the list.' : undefined}
      />

      {/* A source that failed is said out loud. Silently showing a shorter
          agenda would be the worst possible failure for this page: it looks
          exactly like a quiet day. */}
      {agenda.failed.length > 0 && (
        <Banner tone="bad" className="mt-4">
          {agenda.failed.join(' and ')} could not be read just now, so anything from{' '}
          {agenda.failed.length > 1 ? 'them' : 'it'} is missing from this page.
        </Banner>
      )}

      {/* Ticking the last thing due today closes the day: the done tasks
          fold into a pile, the sigil draws in and a line gives the count
          (plan #1556). Mounted all day so it can tell a close made on screen
          from a page that loads closed. */}
      <DayClosed
        key={today}
        closed={closed}
        done={done}
        seed={`${user.id}:${today}:todo`}
        nothingElse={empty}
        className="mt-6"
      />

      {/* Ticking off the last thing draws the day's sigil in (plan #1340),
          unless the day closing above already holds it. */}
      {/* Nothing to narrow on an empty list, unless a filter is what
          emptied it. */}
      {(!empty || filter) && (
        <TagFilterRow pathname="/todo" used={used} filter={filter} className="mt-6" />
      )}

      <QueueCleared cleared={empty}>
        {filter && piles.length === 0 ? (
          <TagFilterEmpty filter={filter} clearHref="/todo" className="mt-6" />
        ) : empty ? (
          closed ? null : (
            <EmptyState
              tone="finished"
              seed={`${user.id}:${today}:todo`}
              title="Nothing on the list."
              description="Write the next thing down and it will be here."
              className="mt-6"
            />
          )
        ) : (
          <AgendaPiles
            piles={piles}
            timezone={agenda.timezone}
            working={working}
            threads={threads}
            files={files}
            className="mt-6"
          />
        )}
      </QueueCleared>

      <NowDashToday workspace="todo" className="mt-8" />
    </PageColumn>
  );
}
