import { LayoutDashboard } from 'lucide-react';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { SpendHeadline } from '@/components/dashboard/spend-headline';
import { CategoryDonut } from '@/components/dashboard/category-donut';
import { MerchantBreakdown } from '@/components/dashboard/merchant-breakdown';
import { ReturnableList } from '@/components/dashboard/returnable-list';
import { PersonBreakdown } from '@/components/dashboard/person-breakdown';
import type { Person } from '@/lib/people/load';
import type { PresetRange } from '@/lib/money';
import { DASHBOARD_RANGES, dashboardHref, type DashboardData } from '@/lib/dashboard/load';

/**
 * The spending dashboard, drawn from what the page read (page.tsx), so the
 * gallery can draw it from fixtures (plan #1604).
 */
export function DashboardView({
  range,
  personId,
  people,
  data,
}: {
  range: PresetRange;
  personId: string | null;
  people: Person[];
  data: DashboardData;
}) {
  const showPeople = people.length > 1;
  const activePerson = personId ? people.find((entry) => entry.id === personId) : null;

  return (
    <div className="flex flex-col gap-6 xl:flex-row [&_a]:press-area">
      <LeftRail>
        <RailGroup label="Time range">
          {DASHBOARD_RANGES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === range}
              href={dashboardHref(entry.id, personId)}
            />
          ))}
        </RailGroup>

        {showPeople && (
          <RailGroup label="Whose">
            <RailItem label="Everyone" active={!personId} href={dashboardHref(range)} />
            {people.map((person) => (
              <RailItem
                key={person.id}
                label={person.name}
                active={personId === person.id}
                href={dashboardHref(range, person.id)}
              />
            ))}
          </RailGroup>
        )}
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Dashboard"
          description={
            activePerson
              ? `${activePerson.name}'s spending, where it went, and what is still returnable.`
              : 'What you spent, where it went, and what is still returnable.'
          }
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
            <SpendHeadline
              current={data.current}
              previous={data.previous}
              range={data.range}
              period={data.period}
              currency={data.currency}
              valueOwnedCents={data.valueOwnedCents}
              orderCount={data.orderCount}
              returnableCount={data.returnable.length}
            />
            <div className="h-2" aria-hidden />

            {showPeople && !personId && (
              <PersonBreakdown
                rows={data.byPerson}
                people={people}
                currency={data.currency}
              />
            )}

            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
              <CategoryDonut slices={data.categories} currency={data.currency} />
              <MerchantBreakdown
                slices={data.merchants}
                currency={data.currency}
                trend={data.merchantTrend}
              />
            </div>

            <ReturnableList rows={data.returnable} />
          </div>
        )}
      </div>
    </div>
  );
}
