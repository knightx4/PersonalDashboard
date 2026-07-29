import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { TopNav } from '@/components/shell/top-nav';
import { InboxSyncBanner } from '@/components/shell/inbox-sync-banner';

/**
 * Shell for every signed-in section.
 *
 * Middleware already blocks unauthenticated requests to this group; the check
 * here is a second line, not the first, and it also gives us the profile.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  const [{ data: profile }, { count: reviewCount }, { data: accounts }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('needs_review', true),
    supabase.from('email_accounts').select('id').eq('user_id', user.id).eq('status', 'active'),
  ]);

  const accountIds = (accounts ?? []).map((a) => a.id as string);
  let initialBannerJob: {
    jobId: string;
    type?: string;
    status: string;
    messagesSeen: number;
    messagesParsed: number;
    done: boolean;
  } | null = null;

  if (accountIds.length > 0) {
    const { data: activeJob } = await supabase
      .from('sync_jobs')
      .select('id, type, status, messages_seen, messages_parsed')
      .in('email_account_id', accountIds)
      .in('status', ['running', 'queued'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeJob) {
      initialBannerJob = {
        jobId: activeJob.id as string,
        type: activeJob.type as string,
        status: activeJob.status as string,
        messagesSeen: activeJob.messages_seen as number,
        messagesParsed: activeJob.messages_parsed as number,
        done: false,
      };
    }
  }

  return (
    <div className="min-h-full">
      <TopNav
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        reviewCount={reviewCount ?? 0}
      />
      <InboxSyncBanner accountIds={accountIds} initialJob={initialBannerJob} />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
