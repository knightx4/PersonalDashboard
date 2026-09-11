import 'server-only';

import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadOpenTasks } from '@/lib/todo/tasks/load';
import { loadEventsInWindow } from '@/lib/todo/events/load';
import { loadLinksForTasks } from '@/lib/todo/links/load';
import { addDays, todayIn } from '@/lib/todo/tasks/model';
import { resolveAnchors } from '@/lib/todo/agenda/anchors';
import { loadDismissals } from '@/lib/todo/agenda/dismissals';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';
import { allSources } from '@/lib/todo/agenda/registry';
import { eventContext } from '@/lib/todo/agenda/events';
import { mergeAgenda, type AgendaPile } from '@/lib/todo/agenda/merge';
import type { AgendaItem, DayContext, SourceContext } from '@/lib/todo/agenda/sources';

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

export async function loadAgenda(userId: string, now: Date = new Date()): Promise<Agenda> {
  const [account, agendaSettings, tasks] = await Promise.all([
    loadAccountSettings(userId),
    loadAgendaSettings(userId),
    loadOpenTasks(userId),
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
  };

  const active = allSources().filter(
    (source) =>
      agendaSettings.enabledSources.includes(source.id) &&
      // A switched-off module's sources never run, whatever this module's own
      // settings say. Turning off a workspace has to mean it stops appearing.
      moduleEnabled(account, source.module),
  );

  // Events are this module's own, so they are read here beside the tasks
  // rather than through a source. A source is for an obligation another
  // workspace owns; there is no switch to give an event and nothing to
  // reconcile. Only from today forward: the merge drops day context dated
  // before today, because a meeting you have been to is over, not overdue.
  const [[items, context, failed], events] = await Promise.all([
    runSources(active, ctx),
    loadEventsInWindow(userId, { from: today, to: ctx.to }, account.timezone),
  ]);

  const links = await loadLinksForTasks(tasks.map((task) => task.id));
  const anchors = await resolveAnchors(links);

  // Only asked for when something might need it: the dismissal overlay exists
  // for sources, and a page with no sources on has nothing to overlay.
  const dismissals = active.length > 0 ? await loadDismissals(userId) : new Map();

  return {
    piles: mergeAgenda({
      tasks,
      items,
      context: [...context, ...eventContext(events, account.timezone, today)],
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
  sources: ReturnType<typeof allSources>,
  ctx: SourceContext,
): Promise<[AgendaItem[], DayContext[], string[]]> {
  const settled = await Promise.allSettled(
    sources.map(async (source) => ({
      items: await source.fetch(ctx),
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

  return [items, context, failed];
}
