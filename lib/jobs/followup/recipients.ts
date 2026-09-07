import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * Who a follow-up should be addressed to.
 *
 * Its own module because two pages need it now: /jobs/today, which has always
 * written the draft rather than the reminder to send one, and the todo
 * module's job source, which shows the same reminders on a merged agenda. A
 * merged agenda that degraded a follow-up into a line of text with a checkbox
 * would be a downgrade, not an integration -- commit fd33268 applies here with
 * full force.
 */

/**
 * The most recent inbound sender on each pursuit.
 *
 * The address a follow-up should go to is whoever last wrote to you about it,
 * which is often a person even when the first confirmation came from a
 * no-reply. Where it is still a no-reply the draft is written anyway, without
 * a recipient -- an unaddressed draft is a smaller problem than no draft.
 */
export async function lastCorrespondents(
  supabase: AppSupabaseClient,
  userId: string,
  applicationIds: readonly (string | null)[],
): Promise<Map<string, { fromAddress: string | null; inbox: string | null }>> {
  const ids = [...new Set(applicationIds.filter((id): id is string => Boolean(id)))];
  const found = new Map<string, { fromAddress: string | null; inbox: string | null }>();
  if (ids.length === 0) return found;

  const { data } = await supabase
    .from('inbox_messages')
    .select('resulting_application_id, from_address, reply_to_address, email_address, received_at')
    .eq('user_id', userId)
    .in('resulting_application_id', ids)
    .order('received_at', { ascending: false });

  for (const row of data ?? []) {
    const id = row.resulting_application_id as string;
    if (found.has(id)) continue;
    found.set(id, {
      // Reply-to first: an ATS sends from a no-reply and points replies at the
      // recruiter, and the recruiter is the one who answers.
      fromAddress: (row.reply_to_address as string) ?? (row.from_address as string) ?? null,
      inbox: (row.email_address as string) ?? null,
    });
  }

  return found;
}
