import 'server-only';

import { sessionClients } from '@/lib/todo/agenda/clients';
import { loadWaitingOnYou, setWaitingDismissal, type WaitingOnYou } from '@/lib/jobs/today/waiting';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Mail from a company that asked you something (plan #1937.9): references,
 * a form, a take-home, a question. It was "Waiting on you" on Jobs' Today;
 * now it is in the Jobs Inbox, and on the agenda with it, as every move on
 * you is (docs/CORE-AND-DASH-SPEC.md Part 4).
 *
 * Always on, like applications on you: a switch could only hide part of what
 * is on you.
 *
 * Read and written where it lives (lib/jobs/today/waiting.ts). Done says it
 * is dealt with for good, Later puts it off to the day chosen, and Not this one is Done:
 * a request you have decided not to answer is finished with.
 */

/** Pure: the agenda items for the requests. Exported for tests. */
export function waitingItems(rows: readonly WaitingOnYou[]): AgendaItem[] {
  return rows.map((row) => {
    const company = row.companyName.trim() || 'the company';
    const ask = row.summary?.trim() || 'They asked you something by mail';
    return {
      key: waitingKey(row.eventId),
      source: 'job_waiting',
      ref: `job_search.application_events:${row.eventId}`,
      // What you do as the title, as every other row in the Inbox has; what
      // they asked goes on the line under it with the role.
      title: `Reply to ${company}`,
      day: null,
      onYouSince: row.occurredAt,
      at: null,
      link: { href: `/jobs/roles/${row.roleId}`, label: `${company} · ${row.roleTitle}` },
      action: null,
      detail: `${ask} · ${row.roleTitle}`,
      completable: true,
      workspace: 'jobs',
    };
  });
}

export const jobWaitingSource: AgendaSource = {
  id: 'job_waiting',
  label: 'Mail waiting on you',
  module: 'jobs',
  alwaysOn: true,
  description: 'Mail from a company that asked you for something, until you mark it dealt with.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const supabase = await (ctx.clients ?? sessionClients).jobs();
    return waitingItems(await loadWaitingOnYou(supabase, ctx.userId, ctx.now));
  },

  async complete(ctx, key) {
    await answer(ctx, key, null);
  },

  async defer(ctx, key, until) {
    await answer(ctx, key, until.toISOString());
  },

  async dismiss(ctx, key) {
    await answer(ctx, key, null);
  },
};

async function answer(ctx: SourceContext, key: string, until: string | null): Promise<void> {
  const supabase = await (ctx.clients ?? sessionClients).jobs();
  const { error } = await setWaitingDismissal(supabase, ctx.userId, eventIdOf(key), until);
  if (error) throw new Error(error);
}

export function waitingKey(eventId: string): string {
  return `job_waiting:${eventId}`;
}

export function eventIdOf(key: string): string {
  return key.slice('job_waiting:'.length);
}
