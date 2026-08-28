import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import {
  filterReturnsRows,
  groupReturnsByOrder,
  loadReturnsTracker,
  parseReturnsGroup,
  parseReturnsView,
  RETURNS_GROUPS,
  RETURNS_VIEWS,
  type ReturnsGroupMode,
  type ReturnsView,
} from '@/lib/returns/load';
import { ReturnItemRow } from './return-item-row';
import { ReturnsOrderList } from './returns-order-list';

export const metadata = { title: 'Returns' };

function returnsHref(
  view: ReturnsView,
  opts?: { merchant?: string; group?: ReturnsGroupMode },
): string {
  const params = new URLSearchParams({ view });
  const group = opts?.group ?? 'items';
  if (group === 'orders') params.set('group', 'orders');
  if (opts?.merchant) params.set('merchant', opts.merchant);
  return `/shopping/returns?${params.toString()}`;
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; merchant?: string; group?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const view = parseReturnsView(params.view);
  const group = parseReturnsGroup(params.group);
  const merchantFilter = params.merchant?.trim() || undefined;

  const data = await loadReturnsTracker(supabase, user.id, view);
  const merchantOptions = [
    ...new Map(
      data.rows
        .filter((row) => row.merchantId)
        .filter((row) => (view === 'returned' ? row.status === 'returned' : row.status === 'owned'))
        .map((row) => [row.merchantId!, row.merchantName] as const),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const rows = filterReturnsRows(data.rows, view, merchantFilter);
  const orderGroups = group === 'orders' ? groupReturnsByOrder(rows) : [];

  const emptyCopy: Record<ReturnsView, { title: string; description: string }> = {
    soon: {
      title: 'Nothing due soon',
      description: `No owned items have a return deadline in the next ${data.dueSoonDays} days.`,
    },
    overdue: {
      title: 'Nothing overdue',
      description: 'No return windows have passed for items you still own.',
    },
    marked: {
      title: 'Nothing marked to return',
      description: 'Mark items from inventory or here when you plan to send them back.',
    },
    all: {
      title: 'No returnable items',
      description:
        'Owned items from your orders show up here with deadlines from each merchant’s return policy.',
    },
    returned: {
      title: 'Nothing returned yet',
      description:
        'When you mark something Returned it leaves inventory and lands here — you can undo if that was a mistake.',
    },
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Group by">
          {RETURNS_GROUPS.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === group}
              href={returnsHref(view, { merchant: merchantFilter, group: entry.id })}
            />
          ))}
        </RailGroup>
        <RailGroup label="View">
          {RETURNS_VIEWS.map((entry) => (
            <RailItem
              key={entry.id}
              label={`${entry.label}${data.counts[entry.id] ? ` (${data.counts[entry.id]})` : ''}`}
              active={entry.id === view}
              href={returnsHref(entry.id, { merchant: merchantFilter, group })}
            />
          ))}
        </RailGroup>
        <RailGroup label="Merchant">
          <RailItem
            label="Any"
            active={!merchantFilter}
            href={returnsHref(view, { group })}
          />
          {merchantOptions.map(([id, name]) => (
            <RailItem
              key={id}
              label={name}
              active={merchantFilter === id}
              href={returnsHref(view, { merchant: id, group })}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Returns"
          description="Track deadlines, mark what you’re sending back, and keep returned items undoable."
          actions={
            <Link
              href="/shopping/settings#return-policies"
              className="text-sm font-medium text-brand hover:underline"
            >
              Edit return policies
            </Link>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title={emptyCopy[view].title}
            description={emptyCopy[view].description}
            action={
              merchantFilter
                ? { label: 'Clear merchant', href: returnsHref(view, { group }) }
                : view !== 'all' && view !== 'returned'
                  ? { label: 'See all items', href: returnsHref('all', { group }) }
                  : { label: 'Open inventory', href: '/shopping/inventory' }
            }
            secondaryAction={
              view === 'all' && !merchantFilter
                ? { label: 'Set return policies', href: '/shopping/settings#return-policies' }
                : undefined
            }
          />
        ) : group === 'orders' ? (
          <ReturnsOrderList groups={orderGroups} />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {rows.map((row) => (
              <ReturnItemRow key={row.inventoryItemId} row={row} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
