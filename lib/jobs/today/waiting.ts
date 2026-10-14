import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { TERMINAL_STATUSES } from '@/lib/jobs/pipeline';

/**
 * Mail that asked you something and has not been answered or set aside:
 * Jobs' "Waiting on you". Read here once for the two places that use it,
 * the Jobs Inbox (lib/todo/agenda/sources/job-waiting.ts, plan #1937.9),
 * which lists each one with its verbs, and Now (lib/jobs/today/load.ts),
 * whose live list counts such mail as putting the move on you and whose
 * "Since you last looked" leaves it out.
 *
 * `action_required` is set by the extractor when the body contains a request
 * rather than a notification, and it is the only signal here that comes from
 * the words rather than from a clock.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back a request is still worth asking about. */
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

/** Newest first. Throws when either read fails, so a caller can say which list is missing. */
export async function loadWaitingOnYou(
  supabase: AppSupabaseClient,
  userId: string,
  now: Date,
): Promise<WaitingOnYou[]> {
  const [eventRows, dismissedRows] = await Promise.all([
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
    // A row with no dismissed_until is set aside for good; one with a future
    // dismissed_until is put off and left out the same way until it passes.
    supabase
      .from('waiting_dismissals')
      .select('application_event_id, dismissed_until')
      .eq('user_id', userId)
      .or(`dismissed_until.is.null,dismissed_until.gt.${now.toISOString()}`),
  ]);

  if (eventRows.error) throw new Error(eventRows.error.message);
  if (dismissedRows.error) throw new Error(dismissedRows.error.message);

  const dismissed = new Set(
    (dismissedRows.data ?? []).map((row) => row.application_event_id as string),
  );
  return ((eventRows.data ?? []) as unknown as EventRaw[])
    // A request on a pursuit that has since closed is not waiting on anybody.
    .filter((row) => !TERMINAL_STATUSES.includes(row.applications.status as never))
    .filter((row) => !dismissed.has(row.id))
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

/**
 * Sets a request aside: for good with `until` null, or until that instant.
 * Upserted, so setting aside one already set aside moves its date.
 */
export async function dismissWaitingEvent(
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
