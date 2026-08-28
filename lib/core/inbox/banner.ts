import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';

/**
 * The inbox state both shells show.
 *
 * There is one mailbox and one sync, so "is a sync running right now" has one
 * answer -- and both workspaces' banners were reading it from their own copy of
 * the tables. Now they ask core, and a backfill started from the job settings
 * page shows up in the shopping shell too, which is what a user would expect
 * from one connected inbox.
 */
export type InboxBannerJob = {
  jobId: string;
  type?: string;
  status: string;
  messagesSeen: number;
  messagesParsed: number;
  done: boolean;
};

export async function loadInboxBannerState(userId: string): Promise<{
  accountIds: string[];
  initialJob: InboxBannerJob | null;
}> {
  const core = await createCoreClient();

  const { data: accounts } = await core
    .from('email_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active');

  const accountIds = (accounts ?? []).map((a) => a.id as string);
  if (accountIds.length === 0) return { accountIds, initialJob: null };

  const { data: activeJob } = await core
    .from('sync_jobs')
    .select('id, type, status, messages_seen, messages_parsed')
    .in('email_account_id', accountIds)
    .in('status', ['running', 'queued'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activeJob) return { accountIds, initialJob: null };

  return {
    accountIds,
    initialJob: {
      jobId: activeJob.id as string,
      type: activeJob.type as string,
      status: activeJob.status as string,
      messagesSeen: activeJob.messages_seen as number,
      messagesParsed: activeJob.messages_parsed as number,
      done: false,
    },
  };
}
