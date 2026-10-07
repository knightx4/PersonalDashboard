import { createClient, requireUser } from '@/lib/auth/server';
import { workingRefsForPage } from '@/lib/talk/handoffs';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadAllTasks, loadParentTitles } from '@/lib/todo/tasks/load';
import { loadLinksForTasks } from '@/lib/todo/links/load';
import { resolveAnchors } from '@/lib/todo/agenda/anchors';
import type { TaskStatus } from '@/lib/todo/tasks/model';
import type { DevComment } from '@/lib/comments/load';
import { loadRowThreads } from '@/lib/thread/store';
import { THREAD_TABLES } from '@/lib/thread/subjects';
import { AllTasksView, FILTERS, type Filter } from './all-view';

export const metadata = { title: 'All tasks' };

/**
 * Everything, including what is finished.
 *
 * Kept off the agenda deliberately: the agenda answers "what needs me" and an
 * archive answers "what happened", and a page that tries to do both ends up
 * being the second one. This is the page you visit to find something, which is
 * why it has a search box and no piles.
 */
export default async function AllTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; focus?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const status: Filter = FILTERS.some((f) => f.id === params.status)
    ? (params.status as Filter)
    : 'open';
  const search = params.q?.trim() ?? '';
  // A task is the one thing in the app with no page of its own, so the command
  // palette sends you here with the row named. Absent, nothing changes.
  const focus = params.focus?.trim() ?? '';

  const [settings, tasks, working] = await Promise.all([
    loadAccountSettings(user.id),
    loadAllTasks(user.id, {
      status: status === 'all' ? 'all' : (status as TaskStatus),
      search,
    }),
    // What an Ask Dash hand-off is working on (plan #1568).
    workingRefsForPage(user.id),
  ]);

  // What each task is about, in one pass for the page. The naive shape resolves
  // a row's anchor as it renders, which is a query per row and does not look
  // slow until the archive is long -- which is the only state this page is ever
  // in. A workspace that cannot be read costs its labels and nothing else;
  // resolveAnchors swallows that per target.
  const links = await loadLinksForTasks(tasks.map((task) => task.id));
  const [anchors, parents, threads] = await Promise.all([
    resolveAnchors(links, undefined, settings.timezone),
    // Which task an item came out of. Only the titles, and only for the rows
    // on this page -- the list here is not nested, so the row has to say it.
    loadParentTitles(user.id, tasks),
    // The thread under each task (plan #1471). A failed read leaves them
    // empty rather than the page broken.
    createClient()
      .then((client) =>
        loadRowThreads(
          client,
          THREAD_TABLES.task,
          tasks.map((task) => task.id),
          { userId: user.id },
        ),
      )
      .catch(() => new Map<string, DevComment[]>()),
  ]);

  return (
    <AllTasksView
      status={status}
      search={search}
      focus={focus}
      tasks={tasks}
      timezone={settings.timezone}
      working={working}
      threads={threads}
      anchors={anchors}
      parents={parents}
      seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:todo-all`}
    />
  );
}
