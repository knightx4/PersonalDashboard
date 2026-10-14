import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * Making a round and the conversations inside it, for every path that does:
 * the role page's "Add round" and "Add interview" (createInterviewRound and
 * addInterview in app/jobs/(app)/roles/[id]/interview-actions.ts) and Dash's
 * add_interview_round (lib/dash/interview-writes.ts, plan #2044.1). Each
 * caller checks its own input and who is asking; these only write, scoped to
 * the user id they are given, so a round is numbered and filled the same way
 * whoever adds it.
 */

/** One past the highest round on the pursuit, so a new round follows the rest. */
export async function nextRoundNumber(
  supabase: AppSupabaseClient,
  opts: { userId: string; applicationId: string },
): Promise<number> {
  const { data: rounds } = await supabase
    .from('interview_groups')
    .select('round_number')
    .eq('application_id', opts.applicationId)
    .eq('user_id', opts.userId);
  return (
    ((rounds ?? []) as { round_number: number | null }[]).reduce(
      (top, row) => Math.max(top, row.round_number ?? 0),
      0,
    ) + 1
  );
}

/** A round with nothing in it yet, numbered after the others unless a number is given. */
export async function insertInterviewRound(
  supabase: AppSupabaseClient,
  opts: { userId: string; applicationId: string; label?: string | null; roundNumber?: number },
): Promise<{ id: string | null; error: string | null }> {
  const roundNumber = opts.roundNumber ?? (await nextRoundNumber(supabase, opts));
  const { data, error } = await supabase
    .from('interview_groups')
    .insert({
      user_id: opts.userId,
      application_id: opts.applicationId,
      label: opts.label || null,
      round_number: roundNumber,
    })
    .select('id')
    .single();
  if (error || !data) return { id: null, error: error?.message ?? 'Could not add the round.' };
  return { id: data.id as string, error: null };
}

/** The next free place inside a round, so a superday reads in order. */
async function positionInRound(supabase: AppSupabaseClient, groupId: string): Promise<number> {
  const { data, count } = await supabase
    .from('interviews')
    .select('id', { count: 'exact' })
    .eq('group_id', groupId);
  return (count ?? (data ?? []).length) + 1;
}

/** One conversation, placed last in the round it goes in. */
export async function insertInterview(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    applicationId: string;
    groupId: string;
    kind: string;
    scheduledAt: string | null;
    timeKnown: boolean;
  },
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('interviews')
    .insert({
      user_id: opts.userId,
      application_id: opts.applicationId,
      round: await positionInRound(supabase, opts.groupId),
      kind: opts.kind,
      group_id: opts.groupId,
      scheduled_at: opts.scheduledAt,
      time_known: opts.scheduledAt === null ? false : opts.timeKnown,
    })
    .select('id')
    .single();
  if (error || !data) return { id: null, error: error?.message ?? 'Could not add the interview.' };
  return { id: data.id as string, error: null };
}
