import { RotateCcw } from 'lucide-react';
import Link from '@/components/ui/link';
import { ListPage } from '@/components/patterns/list-detail';
import { FilterSheet } from '@/components/shell/filter-sheet';
import { RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import {
  filterReturnsRows,
  groupReturnsByOrder,
  RETURNS_GROUPS,
  RETURNS_VIEWS,
  type ReturnsGroupMode,
  type ReturnsTrackerData,
  type ReturnsView,
} from '@/lib/returns/load';
import type { OnTimeSavings } from '@/lib/returns/savings';
import { OnTimeSavingsFigure } from './on-time-savings';
import { ReturnItemRow } from './return-item-row';
import { ReturnsOrderList } from './returns-order-list';

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

/**
 * Returns, drawn from what the page read (page.tsx), so the gallery can draw
 * it from fixtures (plan #1604). A list page of the list-and-detail pattern
 * (plan #1785): the heading and its action, the filters, one surface of rows,
 * then the count, with the year's on-time savings beneath it.
 */
export function ReturnsPageView({
  data,
  savings,
  working,
  view,
  group,
  merchantFilter,
}: {
  data: ReturnsTrackerData;
  savings: OnTimeSavings[];
  working: readonly string[];
  view: ReturnsView;
  group: ReturnsGroupMode;
  merchantFilter: string | undefined;
}) {
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

  const viewLabel = RETURNS_VIEWS.find((entry) => entry.id === view)?.label ?? '';
  const merchantName = merchantOptions.find(([id]) => id === merchantFilter)?.[1];
  const summary = [viewLabel, merchantName, group === 'orders' ? 'By order' : null]
    .filter(Boolean)
    .join(' · ');

  // The heading and its one action, with no line under it: the count at the
  // foot says what the list holds (plan #1785).
  const header = (
    <PageHeader
      title="Returns"
      actions={
        <Link
          href="/shopping/settings#return-policies"
          className="press-area text-ui font-medium text-accent hover:underline"
        >
          Edit return policies
        </Link>
      }
    />
  );

  // What the list is narrowed by, behind one button at every width: the page
  // is one column on a laptop too.
  const tools = (
    <FilterSheet summary={summary}>
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
      <RailGroup label="Merchant">
        <RailItem label="Any" active={!merchantFilter} href={returnsHref(view, { group })} />
        {merchantOptions.map(([id, name]) => (
          <RailItem
            key={id}
            label={name}
            active={merchantFilter === id}
            href={returnsHref(view, { merchant: id, group })}
          />
        ))}
      </RailGroup>
    </FilterSheet>
  );

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <div className="mb-4">{tools}</div>
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
        <OnTimeSavingsFigure savings={savings} className="mt-6" />
      </div>
    );
  }

  return (
    <ListPage
      header={header}
      tools={tools}
      foot={
        <>
          <p>{countLine(rows.length, view)}</p>
          <OnTimeSavingsFigure savings={savings} className="mt-4" />
        </>
      }
    >
      {group === 'orders' ? (
        <ReturnsOrderList groups={orderGroups} working={working} />
      ) : (
        rows.map((row) => <ReturnItemRow key={row.inventoryItemId} row={row} working={working} />)
      )}
    </ListPage>
  );
}

/**
 * The count under the list (plan #1785), in the view's own words: "3 due
 * soon", "1 overdue", "2 to return", "18 items", "4 returned".
 */
export function countLine(count: number, view: ReturnsView): string {
  switch (view) {
    case 'soon':
      return `${count} due soon`;
    case 'overdue':
      return `${count} overdue`;
    case 'marked':
      return `${count} to return`;
    case 'returned':
      return `${count} returned`;
    case 'all':
      return `${count} ${count === 1 ? 'item' : 'items'}`;
  }
}
