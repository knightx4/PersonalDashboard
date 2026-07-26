import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: 'Orders' };

export default async function OrdersPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { count } = await supabase
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
        </RailGroup>
        <RailGroup label="Status">
          <RailItem label="Ordered" />
          <RailItem label="Shipped" />
          <RailItem label="Delivered" />
          <RailItem label="Returned" />
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Orders"
          description="Everything you have bought, newest first."
          actions={
            <Link href="/orders/new" className={buttonVariants({ size: 'sm' })}>
              Add an order
            </Link>
          }
        />

        {count ? (
          <p className="text-sm text-ink-muted">{count} orders. The list arrives with build step 6.</p>
        ) : (
          <EmptyState
            icon={Receipt}
            title="No orders yet"
            description="Orders appear here as we find them in your inbox, grouped by month. You can also add one by hand at any time."
            action={{ label: 'Connect an inbox', href: '/settings/email' }}
            secondaryAction={{ label: 'Add an order', href: '/orders/new' }}
          />
        )}
      </div>
    </div>
  );
}
