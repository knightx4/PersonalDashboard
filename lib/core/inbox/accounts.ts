import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * "Is a mailbox connected?", asked once.
 *
 * Both workspaces ask this -- to decide whether to offer a Connect button, and
 * to grandfather someone past onboarding. There is one mailbox now, so there is
 * one answer, and connecting from either side answers it for both.
 *
 * These take a client rather than building one, like everything else in lib/.
 * Creating one here would mean importing next/headers, which would then reach
 * every module that transitively imports this -- including ones a client
 * component pulls a type or a label from, where it is a build error.
 */
export async function countConnectedInboxes(
  core: CoreSupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await core
    .from('email_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}

/** The connected mailbox ids, for scoping a query to what this user owns. */
export async function connectedAccountIds(
  core: CoreSupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data } = await core.from('email_accounts').select('id').eq('user_id', userId);
  return (data ?? []).map((row) => row.id as string);
}

/** The connected mailboxes with their addresses, for display. */
export async function connectedInboxes(
  core: CoreSupabaseClient,
  userId: string,
): Promise<Array<{ id: string; emailAddress: string }>> {
  const { data } = await core
    .from('email_accounts')
    .select('id, email_address')
    .eq('user_id', userId);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    emailAddress: row.email_address as string,
  }));
}
