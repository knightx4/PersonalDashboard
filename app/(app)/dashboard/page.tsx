import { LayoutDashboard } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Dashboard' };

/**
 * Every figure on this page must come from lib/money.ts. Do not compute spend
 * inline in a component -- there is exactly one definition of what a month
 * cost, and it lives there.
 *
 * Charts and figures land in build step 7, on top of real data from manual
 * order entry. Until then this is the empty state, which a new account sees
 * anyway.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { count: orderCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Time range">
          <RailItem label="This month" active />
          <RailItem label="Last month" />
          <RailItem label="Last 3 months" />
          <RailItem label="Year to date" />
          <RailItem label="Last 12 months" />
          <RailItem label="Custom…" />
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Dashboard"
          description="What you spent, where it went, and what is still returnable."
        />

        {orderCount ? (
          <p className="text-sm text-ink-muted">
            {orderCount} orders. Charts arrive with build step 7.
          </p>
        ) : (
          <EmptyState
            icon={LayoutDashboard}
            title="No spending to show yet"
            description="Connect an inbox and we will pull in your past orders automatically, or add one by hand to see how this looks."
            action={{ label: 'Connect an inbox', href: '/settings/email' }}
            secondaryAction={{ label: 'Add an order', href: '/orders/new' }}
          />
        )}
      </div>
    </div>
  );
}
