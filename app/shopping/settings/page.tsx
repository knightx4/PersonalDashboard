import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadPeople } from '@/lib/people/load';
import { loadMerchantReturnPolicies } from '@/lib/returns/policies';
import { ShoppingSettingsView } from './settings-view';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ inbox?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;

  const settings = await loadAccountSettings(user.id);

  const { data: accounts } = await core
    .from('email_accounts')
    .select('id, email_address, status, last_synced_at, backfill_completed_at, person_id')
    .eq('user_id', user.id);

  const people = await loadPeople(core, user.id);

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

  const { data: itemTags } = await supabase
    .from('item_tags')
    .select('id, name, slug')
    .eq('user_id', user.id)
    .order('name');

  const { data: deletedOrders } = await supabase
    .from('orders')
    .select(
      'id, order_date, total_cents, currency, external_order_number, deleted_at, merchants ( name )',
    )
    .eq('user_id', user.id)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(50);

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
    const { data: jobs } = await core
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
    <ShoppingSettingsView
      email={user.email}
      settings={settings}
      people={people}
      accounts={accounts ?? []}
      bannerCode={params.inbox}
      latestJobs={latestJobs}
      mutedMerchants={mutedMerchants ?? []}
      deletedOrders={(deletedOrders ?? []).filter(
        (row): row is typeof row & { deleted_at: string } => Boolean(row.deleted_at),
      )}
      categories={categories ?? []}
      itemTags={itemTags ?? []}
      lists={lists ?? []}
      returnPolicies={returnPolicies}
    />
  );
}
