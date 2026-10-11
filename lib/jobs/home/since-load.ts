import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { loadActivitySince, type ActivityEntry } from '@/lib/jobs/activity/load';
import { formatDateTime } from '@/lib/jobs/applications/load';
import {
  FIRST_VISIT_DAYS,
  SINCE_LIMIT,
  sinceOf,
  stoppedInboxes,
  type InboxState,
} from '@/lib/jobs/home/since';
import { recordHomeVisit } from '@/lib/jobs/home/visits-store';

/**
 * What "Since you last looked" on Today shows, read in one place so the
 * section itself draws from fixtures in the gallery (plan #1152, #1591).
 *
 * Opening Today records the visit, and the list starts at the visit before
 * this sitting, or FIRST_VISIT_DAYS back on a first visit. A mailbox that has
 * stopped syncing goes above the changes, because it stops them arriving at
 * all. The changes are the activity feed's, newest first and at most
 * SINCE_LIMIT, without the mail This week already lists as waiting on you.
 */
export type SinceView =
  | { state: 'failed'; message: string }
  | {
      state: 'loaded';
      /** "The last 7 days" or "Since 3 Oct, 09:12". */
      hint: string;
      stopped: InboxState[];
      entries: ActivityEntry[];
      /** How many changes there are beyond the ones listed. */
      more: number;
      /** A read failed, so the list may be short. */
      error: string | null;
    };

export async function loadSinceView(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  {
    userId,
    timezone,
    waitingEventIds,
    now = new Date(),
  }: { userId: string; timezone: string; waitingEventIds: readonly string[]; now?: Date },
): Promise<SinceView> {
  let visit;
  try {
    visit = await recordHomeVisit(supabase, { userId, now });
  } catch (error) {
    // Law 2: say it failed rather than showing an empty list as quiet.
    return {
      state: 'failed',
      message: error instanceof Error ? error.message : 'Could not read your last visit.',
    };
  }

  const { since, firstVisit } = sinceOf(visit, now);
  const [activity, accountResult] = await Promise.all([
    loadActivitySince(supabase, userId, {
      since,
      limit: SINCE_LIMIT,
      excludeEventIds: waitingEventIds,
    }),
    core.from('email_accounts').select('id, email_address, status').eq('user_id', userId),
  ]);

  return {
    state: 'loaded',
    hint: firstVisit ? `The last ${FIRST_VISIT_DAYS} days` : `Since ${formatDateTime(since, timezone)}`,
    stopped: stoppedInboxes(
      (accountResult.data ?? []).map((row) => ({
        id: row.id as string,
        emailAddress: row.email_address as string,
        status: row.status as string,
      })),
    ),
    entries: activity.entries,
    more: activity.total - activity.entries.length,
    error: activity.error,
  };
}
