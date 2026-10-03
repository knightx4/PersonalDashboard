import 'server-only';

import { sessionClients } from '@/lib/todo/agenda/clients';
import { dismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import { loadApplicationMoves, type ApplicationMoveRow } from '@/lib/jobs/applications/moves';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Applications whose move is on you, from job_search.applications (plan
 * #1475): a reply to answer, an assessment to do, an interview to prepare
 * for, an offer to answer. While the company has the move the application is
 * in Waiting under its name instead; when the move comes back to you it is
 * here, in "On you, no date", oldest first.
 *
 * Always on, like goal steps. Part 4 of docs/CORE-AND-DASH-SPEC.md puts
 * everything whose move is yours on this list, and a switch that hid it
 * would leave an application that left Waiting showing nowhere on Todo.
 *
 * Not completable: what ends the move is the reply sent or the interview
 * held, which the pipeline records. "Later" and "Not this one" go in the
 * dismissal overlay, keyed by the moment the move came to you, so the next
 * turn shows again.
 */

const ASK: Partial<Record<string, (company: string) => string>> = {
  recruiter_reply: (company) => `Reply to ${company}`,
  assessment_sent: (company) => `Do the ${company} assessment`,
  screen_scheduled: (company) => `Prepare for the ${company} screen`,
  interview_scheduled: (company) => `Prepare for the ${company} interview`,
  offer: (company) => `Answer the ${company} offer`,
};

/** Pure: the agenda items for the applications on you. Exported for tests. */
export function applicationItems(rows: readonly ApplicationMoveRow[]): AgendaItem[] {
  return rows
    .filter((row) => row.move.state === 'on_you')
    .map((row) => {
      const company = row.companyName.trim() || 'the company';
      const ask =
        (row.lastEvent && ASK[row.lastEvent]) || (row.status === 'offer' ? ASK.offer : undefined);
      return {
        key: `applications:${row.applicationId}:${row.since}`,
        source: 'applications',
        ref: `job_search.applications:${row.applicationId}`,
        title: ask ? ask(company) : `Your move with ${company}`,
        day: null,
        onYouSince: row.since,
        at: null,
        link: row.roleId
          ? { href: `/jobs/roles/${row.roleId}`, label: row.roleTitle || 'the role' }
          : { href: '/jobs', label: 'Jobs home' },
        action: null,
        detail: null,
        completable: false,
      } satisfies AgendaItem;
    });
}

export const applicationsSource: AgendaSource = {
  id: 'applications',
  label: 'Applications on you',
  module: 'jobs',
  alwaysOn: true,
  description: 'Applications where the company has answered and the next move is yours.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const supabase = await (ctx.clients ?? sessionClients).jobs();
    return applicationItems(await loadApplicationMoves(supabase, ctx.userId));
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    await dismiss(ctx.userId, 'application', key, until);
  },

  async dismiss(ctx, key) {
    await dismiss(ctx.userId, 'application', key, null);
  },
};
