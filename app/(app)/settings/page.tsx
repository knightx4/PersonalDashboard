import { ListChecks, Mail, RotateCcw, ShieldCheck, Tags, User } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { signOut } from '@/app/(auth)/actions';
import { loadMerchantReturnPolicies } from '@/lib/returns/policies';
import { CategoriesSection } from './categories-section';
import { InboxSection } from './inbox-section';
import { ListsSection } from './lists-section';
import { MutedMerchantsSection, MutedMerchantsTitle } from './muted-merchants';
import { ReturnPoliciesSection } from './return-policies-section';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ inbox?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, timezone')
    .eq('id', user.id)
    .single();

  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id, email_address, status, last_synced_at, backfill_completed_at')
    .eq('user_id', user.id);

  const { data: mutedMerchants } = await supabase
    .from('merchant_exclusions')
    .select('id, match_domain, merchants ( name )')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug, color, user_id')
    .is('parent_id', null)
    .order('name');

  const { data: lists } = await supabase
    .from('item_lists')
    .select('id, name, slug, color')
    .eq('user_id', user.id)
    .order('name');

  const returnPolicies = await loadMerchantReturnPolicies(supabase, user.id);

  const accountIds = (accounts ?? []).map((a) => a.id as string);
  const latestJobs: Record<
    string,
    {
      jobId: string;
      type?: string;
      status: string;
      messagesSeen: number;
      messagesClassified: number;
      messagesParsed: number;
      ordersCreated: number;
      skipped: number;
      errors: number;
      done: boolean;
      error?: string;
    } | null
  > = {};

  if (accountIds.length > 0) {
    const { data: jobs } = await supabase
      .from('sync_jobs')
      .select(
        'id, email_account_id, type, status, messages_seen, messages_classified, messages_parsed, error',
      )
      .in('email_account_id', accountIds)
      .order('created_at', { ascending: false });

    for (const job of jobs ?? []) {
      const accountId = job.email_account_id as string;
      if (latestJobs[accountId]) continue;
      const done = job.status === 'completed' || job.status === 'failed';
      latestJobs[accountId] = {
        jobId: job.id as string,
        type: job.type as string,
        status: job.status as string,
        messagesSeen: job.messages_seen as number,
        messagesClassified: job.messages_classified as number,
        messagesParsed: job.messages_parsed as number,
        ordersCreated: job.messages_parsed as number,
        skipped: Math.max(0, (job.messages_seen as number) - (job.messages_parsed as number)),
        errors: 0,
        done,
        error: (job.error as string | null) ?? undefined,
      };
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="size-4 text-ink-muted" strokeWidth={1.75} />
              Profile
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-sm text-ink-muted">
            <p>{profile?.display_name ?? '—'}</p>
            <p>{user.email}</p>
            {/* Period boundaries use this, so "this month" means their month. */}
            <p>Timezone: {profile?.timezone ?? 'UTC'}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4 text-ink-muted" strokeWidth={1.75} />
              Connected inboxes
            </CardTitle>
          </CardHeader>
          <CardBody>
            <InboxSection
              accounts={accounts ?? []}
              bannerCode={params.inbox}
              latestJobs={latestJobs}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <MutedMerchantsTitle />
            </CardTitle>
          </CardHeader>
          <CardBody>
            <MutedMerchantsSection exclusions={mutedMerchants ?? []} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="size-4 text-ink-muted" strokeWidth={1.75} />
              Categories
            </CardTitle>
          </CardHeader>
          <CardBody>
            <CategoriesSection categories={categories ?? []} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-ink-muted" strokeWidth={1.75} />
              Lists
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ListsSection lists={lists ?? []} />
          </CardBody>
        </Card>

        <Card id="return-policies">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="size-4 text-ink-muted" strokeWidth={1.75} />
              Return policies
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ReturnPoliciesSection policies={returnPolicies} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-ink-muted" strokeWidth={1.75} />
              Your data
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-muted">
              We never store the contents of your email. Deleting your account revokes our
              access to your inbox and removes every row we hold. Arrives with build step 15.
            </p>
            <form action={signOut}>
              <Button variant="secondary" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
