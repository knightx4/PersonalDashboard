import 'server-only';

import { sessionClients } from '@/lib/todo/agenda/clients';
import { dismissWaitingEvent, loadWaitingOnYou, type WaitingOnYou } from '@/lib/jobs/today/waiting';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource } from '@/lib/todo/agenda/sources';

/**
 * Mail that asked you something, from job_search.application_events (plan
 * #1937.9): what Jobs' Today listed as "Waiting on you" until Today became
 * Now and its Inbox. Read by lib/jobs/today/waiting.ts, the same reader Now
 * uses, so the two cannot disagree about what is waiting.
 *
 * Done and "Not this one" set the email aside for good and Later puts it off
 * for a week, in job_search.waiting_dismissals, where Today's own buttons
 * wrote them, so Now's live list stops counting it as soon as it is gone
 * from the Inbox.
 *
 * Each covers its application, so the same ask is not listed again as
 * "Reply to Monzo" by the applications source.
 */

const PREFIX = 'job_waiting:';

/** "Tue 7 Oct", the day the email came, in the reader's zone. */
function wroteOn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** Pure: the agenda items for the requests waiting on you. Exported for tests. */
export function waitingItems(rows: readonly WaitingOnYou[], timezone: string): AgendaItem[] {
  return rows.map((row) => {
    const company = row.companyName.trim() || 'the company';
    const role = `${company}${row.roleTitle ? ` · ${row.roleTitle}` : ''}`;
    const summary = row.summary?.trim();
    return {
      key: `${PREFIX}${row.eventId}`,
      source: 'job_waiting',
      ref: `job_search.application_events:${row.eventId}`,
      // The request is what says which email this is; with none, the company.
      title: summary || `Reply to ${company}`,
      day: null,
      onYouSince: row.occurredAt,
      at: null,
      link: { href: `/jobs/roles/${row.roleId}`, label: role },
      action: null,
      // Who asked, and how long it has been waiting.
      detail: `${summary ? `${role} · ` : ''}wrote ${wroteOn(row.occurredAt, timezone)}`,
      completable: true,
      workspace: 'jobs',
      covers: [`job_search.applications:${row.applicationId}`],
    } satisfies AgendaItem;
  });
}

function idOf(key: string): string {
  return key.slice(PREFIX.length);
}

export const jobWaitingSource: AgendaSource = {
  id: 'job_waiting',
  label: 'Mail waiting on a reply',
  module: 'jobs',
  inboxAlwaysOn: true,
  description: 'Emails from a company that asked you something you have not answered yet.',

  async fetch(ctx) {
    const supabase = await (ctx.clients ?? sessionClients).jobs();
    return waitingItems(await loadWaitingOnYou(supabase, ctx.userId, ctx.now), ctx.timezone);
  },

  async complete(ctx, key) {
    const supabase = await (ctx.clients ?? sessionClients).jobs();
    const { error } = await dismissWaitingEvent(supabase, ctx.userId, idOf(key), null);
    if (error) throw new Error(error);
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    const supabase = await (ctx.clients ?? sessionClients).jobs();
    const { error } = await dismissWaitingEvent(supabase, ctx.userId, idOf(key), until.toISOString());
    if (error) throw new Error(error);
  },

  /** An email you will not answer is finished with, the same as one you did. */
  async dismiss(ctx, key) {
    await jobWaitingSource.complete?.(ctx, key);
  },
};
