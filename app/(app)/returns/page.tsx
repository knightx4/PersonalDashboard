import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/money';
import { deadlineLabel } from '@/lib/returns/deadline';
import { displayVariant } from '@/lib/inventory/display';
import {
  filterReturnsRows,
  loadReturnsTracker,
  parseReturnsView,
  RETURNS_VIEWS,
  type ReturnsView,
} from '@/lib/returns/load';
import {
  MarkReturnedButton,
  PlanReturnButton,
  UndoReturnedButton,
} from './plan-return-button';

export const metadata = { title: 'Returns' };

function returnsHref(view: ReturnsView, merchant?: string): string {
  const params = new URLSearchParams({ view });
  if (merchant) params.set('merchant', merchant);
  return `/returns?${params.toString()}`;
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; merchant?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const view = parseReturnsView(params.view);
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
        <RailGroup label="View">
          {RETURNS_VIEWS.map((entry) => (
            <RailItem
              key={entry.id}
              label={`${entry.label}${data.counts[entry.id] ? ` (${data.counts[entry.id]})` : ''}`}
              active={entry.id === view}
              href={returnsHref(entry.id, merchantFilter)}
            />
          ))}
        </RailGroup>
        <RailGroup label="Merchant">
          <RailItem label="Any" active={!merchantFilter} href={returnsHref(view)} />
          {merchantOptions.map(([id, name]) => (
            <RailItem
              key={id}
              label={name}
              active={merchantFilter === id}
              href={returnsHref(view, id)}
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
              href="/settings#return-policies"
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
                ? { label: 'Clear merchant', href: returnsHref(view) }
                : view !== 'all' && view !== 'returned'
                  ? { label: 'See all items', href: returnsHref('all') }
                  : { label: 'Open inventory', href: '/inventory' }
            }
            secondaryAction={
              view === 'all' && !merchantFilter
                ? { label: 'Set return policies', href: '/settings#return-policies' }
                : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {rows.map((row) => {
              const urgency =
                row.daysLeft != null && row.daysLeft <= 7
                  ? 'text-accent-orange font-medium'
                  : 'text-ink-muted';
              const returned = row.status === 'returned';
              return (
                <li
                  key={row.inventoryItemId}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">
                          {row.name}
                          {row.returnPlanned && !returned && (
                            <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-brand">
                              To return
                            </span>
                          )}
                          {returned && (
                            <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                              Returned
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[13px] text-ink-muted">
                          {[row.merchantName, displayVariant(row.variant)]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <p className="tabular shrink-0 text-sm font-medium text-ink">
                        {formatMoney(row.costCents)}
                      </p>
                    </div>
                    <p className={`mt-1 text-[12px] ${returned ? 'text-ink-muted' : urgency}`}>
                      {returned
                        ? row.refundedAt
                          ? `Returned ${row.refundedAt}`
                          : 'Returned'
                        : row.returnDeadline && row.daysLeft != null
                          ? deadlineLabel(row.daysLeft, row.returnDeadline)
                          : row.returnWindowDays == null
                            ? 'No return window set for this merchant'
                            : 'Awaiting delivery for deadline'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                    {returned && row.returnId ? (
                      <UndoReturnedButton
                        itemId={row.inventoryItemId}
                        returnId={row.returnId}
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <PlanReturnButton
                          itemId={row.inventoryItemId}
                          planned={row.returnPlanned}
                        />
                        <MarkReturnedButton itemId={row.inventoryItemId} />
                      </div>
                    )}
                    <Link
                      href={`/orders/${row.orderId}`}
                      className="text-[12px] text-ink-muted hover:text-brand hover:underline"
                    >
                      View order
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
