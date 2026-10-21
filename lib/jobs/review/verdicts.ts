import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * The verdicts the Jobs review queue takes, as its buttons and bulk bar and
 * Dash's review_application, review_events and review_emails write them
 * (plan #2473.2). Each returns the rows it wrote, so Dash can keep them for
 * its Undo.
 */

type Row = Record<string, unknown>;
type Many = { rows: Row[]; error: string | null };

async function many(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Many> {
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as Row[], error: null };
}

/** An application the inbox found, confirmed as a real pursuit. */
export async function confirmApplicationRow(supabase: AppSupabaseClient, userId: string, applicationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('applications').update({ needs_review: false }).eq('id', applicationId).eq('user_id', userId);
  return { error: error?.message ?? null };
}

export type ReopenStatus = 'in_process' | 'final_round';

/**
 * A closed pursuit reopened by hand: a status_override event says so on the
 * timeline, and the override sets the stage. A stray email never does this
 * on its own. When the override cannot be written the event is taken back, so
 * the timeline never claims a reopen that did not happen.
 */
export async function reopenApplicationRows(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  status: ReopenStatus,
): Promise<{ eventId: string | null; error: string | null }> {
  const { data: event, error: eventError } = await supabase
    .from('application_events')
    .insert({
      user_id: userId,
      application_id: applicationId,
      kind: 'status_override',
      occurred_at: new Date().toISOString(),
      source: 'manual',
      summary: `Reopened by hand as ${status.replace(/_/g, ' ')}`,
      payload: { status },
    })
    .select('id')
    .maybeSingle();
  if (eventError || !event) return { eventId: null, error: eventError?.message ?? 'The reopen was not recorded.' };
  const eventId = (event as Row).id as string;

  const { error } = await supabase.from('applications').update({ status_manual_override: status }).eq('id', applicationId).eq('user_id', userId);
  if (error) {
    await supabase.from('application_events').delete().eq('id', eventId).eq('user_id', userId);
    return { eventId: null, error: error.message };
  }
  return { eventId, error: null };
}

/**
 * Flagged events acknowledged: they stay on the timeline and the flag goes.
 * `acknowledged_at` is what makes it stick, since the sync trigger re-derives
 * the flag on every event of a closed pursuit.
 */
export function acknowledgeEventRows(supabase: AppSupabaseClient, userId: string, eventIds: readonly string[]): Promise<Many> {
  return many(
    supabase
      .from('application_events')
      .update({ needs_review: false, acknowledged_at: new Date().toISOString() })
      .in('id', [...eventIds])
      .eq('user_id', userId)
      .select('*'),
  );
}

/** The way back from an acknowledgement: the stamp goes with the flag, or the flag would not come back. */
export function unacknowledgeEventRows(supabase: AppSupabaseClient, userId: string, eventIds: readonly string[]): Promise<Many> {
  return many(
    supabase
      .from('application_events')
      .update({ needs_review: true, acknowledged_at: null })
      .in('id', [...eventIds])
      .eq('user_id', userId)
      .select('*'),
  );
}

/** What dismissing an email writes: not relevant, skipped, and its suggested link cleared. */
export const DISMISSED_MESSAGE = {
  classification: 'not_relevant',
  parse_status: 'skipped',
  resulting_application_id: null,
  link_method: null,
  link_confidence: null,
  error: null,
} as const;

/**
 * Emails dismissed from the queue. The verdict rows have no user_id: the
 * caller has read each through job_search.inbox_messages by the person's id,
 * or relies on the person's own session.
 */
export function dismissMessageRows(supabase: AppSupabaseClient, messageIds: readonly string[]): Promise<Many> {
  return many(supabase.from('ingested_messages').update(DISMISSED_MESSAGE).in('id', [...messageIds]).select('*'));
}

/** An email's verdict set back: to what it was before a dismissal, or into the queue again. */
export function restoreMessageRow(supabase: AppSupabaseClient, messageId: string, set: Row): Promise<Many> {
  return many(supabase.from('ingested_messages').update(set).eq('id', messageId).select('*'));
}
