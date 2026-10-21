import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { stageMoveEvent, type StageMoveBy } from '@/lib/jobs/move';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * Moving applications to another stage, as the pipeline's board and status
 * picker and Dash's move_roles do (plan #2473.2).
 *
 * A move writes a status_override event and sets the override column. It
 * never writes `status`: public.sync_application_state() owns that column and
 * works it out from the event log the moment the override lands.
 */

/** Ghosted is worked out from silence, so nobody sets it by hand. */
export const GHOSTED_REFUSAL = 'Ghosted is worked out from silence, so it cannot be set by hand.';

export type StageMoved = {
  /** The event written for each application, by its id. */
  events: Map<string, string>;
  /** The applications whose override was set. */
  moved: Set<string>;
  error: string | null;
};

export async function moveApplicationsTo(
  supabase: AppSupabaseClient,
  userId: string,
  applicationIds: readonly string[],
  status: ApplicationStatus,
  by: StageMoveBy,
): Promise<StageMoved> {
  const none: StageMoved = { events: new Map(), moved: new Set(), error: null };
  // Letting ghosted be set means nobody maintains it, and the funnel then
  // treats abandoned pursuits as live ones.
  if (status === 'ghosted') return { ...none, error: GHOSTED_REFUSAL };
  if (applicationIds.length === 0) return none;

  const at = new Date().toISOString();
  const { data: events, error: eventError } = await supabase
    .from('application_events')
    .insert(applicationIds.map((id) => stageMoveEvent(userId, id, status, by, at)))
    .select('id, application_id');
  if (eventError) return { ...none, error: eventError.message };

  const { data: updated, error } = await supabase
    .from('applications')
    .update({ status_manual_override: status })
    .eq('user_id', userId)
    .in('id', [...applicationIds])
    .select('id');
  const eventOf = new Map(((events ?? []) as { id: string; application_id: string }[]).map((e) => [e.application_id, e.id]));
  if (error) return { events: eventOf, moved: new Set(), error: error.message };
  return { events: eventOf, moved: new Set(((updated ?? []) as { id: string }[]).map((row) => row.id)), error: null };
}
