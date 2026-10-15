import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { TERMINAL_STATUSES } from '@/lib/jobs/pipeline';

/**
 * Mail that asked you something, until you say it is dealt with.
 *
 * Read by Jobs' Now, which counts it as putting an application's move on you,
 * and by the agenda's job_waiting source, which lists it in the Jobs Inbox
 * (plan #1937.9). One reader, so the two cannot disagree about what is waiting.
 *
 * `action_required` is set by the extractor when the body contains a request
 * rather than a notification, and it is the only signal here that comes from
 * the words rather than from a clock.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back a request is still worth listing. */
export const WAITING_WINDOW_DAYS = 21;

export interface WaitingOnYou {
  eventId: string;
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  kind: string;
  summary: string | null;
  occurredAt: string;
}

type RoleJoin = { id: string; title: string; companies: { name: string } };

type EventRaw = {
  id: string;
  application_id: string;
  kind: string;
  summary: string | null;
  occurred_at: string;
  applications: { status: string; roles: RoleJoin };
};

export async function loadWaitingOnYou(
  supabase: AppSupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<WaitingOnYou[]> {
  const [events, dismissed] = await Promise.all([
    supabase
      .from('application_events')
      .select(
        'id, application_id, kind, summary, occurred_at, applications!inner ( status, roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      .eq('payload->>action_required', 'true')
      .gte('occurred_at', new Date(now.getTime() - WAITING_WINDOW_DAYS * DAY_MS).toISOString())
      .order('occurred_at', { ascending: false })
      .limit(30),
    // A row with no dismissed_until is dealt with for good; one with a future
    // dismissed_until is put off and left out the same way until it passes.
    supabase
      .from('waiting_dismissals')
      .select('application_event_id, dismissed_until')
      .eq('user_id', userId)
      .or(`dismissed_until.is.null,dismissed_until.gt.${now.toISOString()}`),
  ]);

  if (events.error) throw new Error(events.error.message);

  const gone = new Set((dismissed.data ?? []).map((row) => row.application_event_id as string));
  return ((events.data ?? []) as unknown as EventRaw[])
    // A request on a pursuit that has since closed is not waiting on anybody.
    .filter((row) => !TERMINAL_STATUSES.includes(row.applications.status as never))
    .filter((row) => !gone.has(row.id))
    .map((row) => ({
      eventId: row.id,
      applicationId: row.application_id,
      roleId: row.applications.roles.id,
      companyName: row.applications.roles.companies.name,
      roleTitle: row.applications.roles.title,
      kind: row.kind,
      summary: row.summary,
      occurredAt: row.occurred_at,
    }));
}

/** The request's application event, from a row's ref, or null for any other row. */
export function waitingEventId(ref: string): string | null {
  const prefix = 'job_search.application_events:';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

/**
 * Says a request is dealt with (`until` null) or puts it off to `until`.
 *
 * The request has no row of its own to mark: it is read from the event log on
 * every load, so the answer lives in waiting_dismissals, upserted so a second
 * answer replaces the first.
 */
export async function setWaitingDismissal(
  supabase: AppSupabaseClient,
  userId: string,
  eventId: string,
  until: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('waiting_dismissals')
    .upsert(
      { user_id: userId, application_event_id: eventId, dismissed_until: until },
      { onConflict: 'user_id,application_event_id' },
    );
  return { error: error?.message ?? null };
}
