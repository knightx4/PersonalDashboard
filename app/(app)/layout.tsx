import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { TopNav } from '@/components/shell/top-nav';
import { InboxSyncBanner } from '@/components/shell/inbox-sync-banner';
import { onboardingNeeded } from '@/lib/onboarding';
import { countReviewItems } from '@/lib/review/load';

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

  if (await onboardingNeeded(supabase, user)) {
    redirect('/onboarding');
  }

  const [{ data: profile }, reviewCount, { data: accounts }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    countReviewItems(supabase, user.id),
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
        reviewCount={reviewCount}
      />
      <InboxSyncBanner accountIds={accountIds} initialJob={initialBannerJob} />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
