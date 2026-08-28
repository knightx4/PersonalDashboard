import { LayoutDashboard } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { SpendHeadline } from '@/components/dashboard/spend-headline';
import { CategoryDonut } from '@/components/dashboard/category-donut';
import { MerchantBreakdown } from '@/components/dashboard/merchant-breakdown';
import { ReturnableList } from '@/components/dashboard/returnable-list';
import { ValueOwnedCard } from '@/components/dashboard/value-owned-card';
import {
  DASHBOARD_RANGES,
  dashboardHref,
  loadDashboard,
  parseDashboardRange,
} from '@/lib/dashboard/load';

export const metadata = { title: 'Dashboard' };

/**
 * Every figure on this page comes from lib/money.ts. Do not compute spend
 * inline here -- there is exactly one definition of what a month cost, and it
 * lives there.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const range = parseDashboardRange(params.range);
  const data = await loadDashboard(supabase, user.id, range);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Time range">
          {DASHBOARD_RANGES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === range}
              href={dashboardHref(entry.id)}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Dashboard"
          description="What you spent, where it went, and what is still returnable."
        />

        {data.orderCount === 0 ? (
          <EmptyState
            icon={LayoutDashboard}
            title="No spending to show yet"
            description="Connect an inbox and we will pull in your past orders automatically, or add one by hand to see how this looks."
            action={{ label: 'Connect an inbox', href: '/shopping/settings#inboxes' }}
            secondaryAction={{ label: 'Add an order', href: '/shopping/orders/new' }}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <SpendHeadline
                current={data.current}
                previous={data.previous}
                range={data.range}
                currency={data.currency}
              />
              <ValueOwnedCard
                cents={data.valueOwnedCents}
                currency={data.currency}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <CategoryDonut slices={data.categories} currency={data.currency} />
              <MerchantBreakdown slices={data.merchants} currency={data.currency} />
            </div>

            <ReturnableList rows={data.returnable} />
          </div>
        )}
      </div>
    </div>
  );
}
