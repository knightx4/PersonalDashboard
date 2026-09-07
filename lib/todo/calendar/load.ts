import 'server-only';

import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { loadAllTasks } from '@/lib/todo/tasks/load';
import { loadDismissals } from '@/lib/todo/agenda/dismissals';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';
import { allSources } from '@/lib/todo/agenda/registry';
import { todayIn } from '@/lib/todo/tasks/model';
import { buildMonth, monthOf, monthWindow, type CalendarMonth } from '@/lib/todo/calendar/month';
import type { AgendaItem, DayContext, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Everything a month needs, fetched in parallel and laid out by the pure
 * function next door.
 *
 * The same sources the agenda reads, asked for the grid's window instead of the
 * agenda's horizon -- so a month you page forward to shows the interviews and
 * return deadlines that are actually in it, and the calendar can never disagree
 * with the list about what is happening on a Thursday.
 */

export interface Calendar extends CalendarMonth {
  timezone: string;
  /** Sources that were switched on and did not answer, named for the page. */
  failed: string[];
}

export async function loadCalendar(
  userId: string,
  month?: string,
  now: Date = new Date(),
): Promise<Calendar> {
  const [account, agendaSettings, tasks] = await Promise.all([
    loadAccountSettings(userId),
    loadAgendaSettings(userId),
    // Every task, not only the open ones: a month that hid what you finished
    // would be a worse record of the month than your memory of it.
    loadAllTasks(userId, { status: 'all' }),
  ]);

  const shown = month ?? monthOf(todayIn(account.timezone, now));
  const window = monthWindow(shown);

  const ctx: SourceContext = {
    userId,
    timezone: account.timezone,
    from: window.from,
    to: window.to,
    now,
  };

  const active = allSources().filter(
    (source) =>
      agendaSettings.enabledSources.includes(source.id) &&
      moduleEnabled(account, source.module),
  );

  const [items, context, failed] = await runSources(active, ctx);
  const dismissals = active.length > 0 ? await loadDismissals(userId) : new Map();

  return {
    ...buildMonth({
      month: shown,
      tasks,
      items,
      context,
      dismissals,
      timezone: account.timezone,
      now,
    }),
    timezone: account.timezone,
    failed,
  };
}

/**
 * One source failing costs its rows, not the page.
 *
 * Copied in spirit from lib/todo/agenda/load.ts rather than shared with it: the
 * two pages ask for different windows and the agenda's version is entangled
 * with its horizon. Both name what did not answer, which is the part that
 * matters -- a silently shorter month looks exactly like a quiet one.
 */
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
