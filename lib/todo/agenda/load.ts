import 'server-only';

import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadOpenTasks } from '@/lib/todo/tasks/load';
import { loadEventsInWindow } from '@/lib/todo/events/load';
import { loadFeedEventsInWindow } from '@/lib/todo/feeds/load';
import { loadLinksForTasks } from '@/lib/todo/links/load';
import { addDays, todayIn } from '@/lib/todo/tasks/model';
import { resolveAnchors } from '@/lib/todo/agenda/anchors';
import { loadDismissals } from '@/lib/todo/agenda/dismissals';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';
import { activeSources, allSources } from '@/lib/todo/agenda/registry';
import { eventContext, subscribedContext } from '@/lib/todo/agenda/events';
import { sessionClients, type AgendaClients } from '@/lib/todo/agenda/clients';
import { mergeAgenda, type AgendaPile } from '@/lib/todo/agenda/merge';
import type { AgendaItem, DayContext, SourceContext } from '@/lib/todo/agenda/sources';
import type { ModuleId } from '@/lib/modules';
import { withoutCoveredThreads } from '@/lib/todo/agenda/sources/threads';

/**
 * Everything the agenda needs, fetched in parallel and merged by a pure
 * function next door.
 *
 * One client per schema, because a client is bound to exactly one. That is the
 * cost of schema separation and it is priced in: they run together, and a
 * source that fails degrades to nothing rather than taking the page down --
 * your own todos must render when the vault's token has expired.
 */

export interface Agenda {
  piles: AgendaPile[];
  timezone: string;
  /** Sources that were switched on and did not answer, named for the page. */
  failed: string[];
}

export interface AgendaOptions {
  /**
   * Only what a workspace's Inbox needs (plan #1937.5): the sources that can
   * find its rows, no calendar, and Todo's tasks only for Todo. The piles
   * still come from the one merge, so the rows and their dismissals are the
   * agenda's own; lib/todo/agenda/workspace.ts cuts them to the workspace.
   */
  workspace?: ModuleId;
}

export async function loadAgenda(
  userId: string,
  now: Date = new Date(),
  clients: AgendaClients = sessionClients,
  options: AgendaOptions = {},
): Promise<Agenda> {
  const { workspace } = options;
  // Asked for once and shared: on a page each is a cookie-bound client, and
  // from the morning brief's cron each is a service-role one.
  const [core, todo] = await Promise.all([clients.core(), clients.todo()]);
  const [account, agendaSettings, tasks] = await Promise.all([
    loadAccountSettings(userId, core),
    loadAgendaSettings(userId, todo),
    workspace && workspace !== 'todo' ? Promise.resolve([]) : loadOpenTasks(userId, todo),
  ]);

  const today = todayIn(account.timezone, now);
  const ctx: SourceContext = {
    userId,
    timezone: account.timezone,
    // Backwards as well as forwards: an overdue reminder from last month is
    // the most important thing on the page, and a window that starts today
    // would be a page that only shows what is not yet late.
    from: addDays(today, -365),
    to: addDays(today, agendaSettings.horizonDays),
    now,
    clients,
  };

  // A switched-off module's sources never run, whatever this module's own
  // settings say. Turning off a workspace has to mean it stops appearing.
  //
  // Todo's switches say what the agenda borrows from other workspaces. A
  // workspace's own Inbox lists its own sources whatever they say (plan
  // #1937.9): Jobs' reminders left Today for the Jobs Inbox, and a switch on
  // Todo's settings must not be what hides them there.
  const enabled = workspace
    ? [
        ...agendaSettings.enabledSources,
        ...allSources()
          .filter((source) => source.module === workspace)
          .map((source) => source.id),
      ]
    : agendaSettings.enabledSources;
  const active = activeSources(account, enabled).filter(
    (source) => !workspace || source.module === workspace || source.crossesWorkspaces,
  );

  // Events are this module's own, so they are read here beside the tasks
  // rather than through a source. A source is for an obligation another
  // workspace owns; there is no switch to give an event and nothing to
  // reconcile. Only from today forward: the merge drops day context dated
  // before today, because a meeting you have been to is over, not overdue.
  const [[items, context, failed], events, feedEvents] = await Promise.all([
    runSources(active, ctx),
    // An Inbox lists what is on you; a meeting in the day is not.
    workspace
      ? Promise.resolve([])
      : loadEventsInWindow(userId, { from: today, to: ctx.to }, account.timezone, todo),
    // The calendars you subscribe to, read from the stored copy over the same
    // days. An appointment somebody else scheduled is context like any other
    // event: it is on your day and there is nothing to tick.
    workspace
      ? Promise.resolve([])
      : loadFeedEventsInWindow(userId, { from: today, to: ctx.to }, account.timezone, todo),
  ]);

  const links = await loadLinksForTasks(
    tasks.map((task) => task.id),
    todo,
  );
  const anchors = await resolveAnchors(links, clients, account.timezone);

  // Only asked for when something might need it: the dismissal overlay exists
  // for sources, and a page with no sources on has nothing to overlay.
  const dismissals = active.length > 0 ? await loadDismissals(userId, todo) : new Map();

  return {
    piles: mergeAgenda({
      tasks,
      items,
      context: [
        ...context,
        ...eventContext(events, account.timezone, today),
        ...subscribedContext(feedEvents, account.timezone, today),
      ],
      dismissals,
      anchors,
      timezone: account.timezone,
      now,
      horizonDays: agendaSettings.horizonDays,
    }),
    timezone: account.timezone,
    failed,
  };
}

async function runSources(
  sources: ReturnType<typeof activeSources>,
  ctx: SourceContext,
): Promise<[AgendaItem[], DayContext[], string[]]> {
  const settled = await Promise.allSettled(
    sources.map(async (source) => ({
      items: (await source.fetch(ctx)).map((item) =>
        source.restore ? { ...item, restorable: true } : item,
      ),
      context: (await source.context?.(ctx)) ?? [],
    })),
  );

  const items: AgendaItem[] = [];
  const context: DayContext[] = [];
  const failed: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value.items);
      context.push(...result.value.context);
    } else {
      failed.push(sources[index].label);
    }
  });

  // A row listed by its own source and by a thread under it shows once, as itself.
  return [withoutCoveredThreads(items), context, failed];
}
