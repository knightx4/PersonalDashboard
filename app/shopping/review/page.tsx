import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import {
  filterReviewRows,
  loadReviewQueue,
  parseReviewView,
  REVIEW_VIEWS,
  type ReviewView,
} from '@/lib/review/load';
import {
  ConfirmOrderButton,
  DiscardOrderButton,
  DismissEmailButton,
} from './review-buttons';

export const metadata = { title: 'Review' };

function reviewHref(view: ReviewView): string {
  if (view === 'all') return '/shopping/review';
  return `/shopping/review?view=${view}`;
}

function classificationLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

/**
 * Everything that failed a guardrail or was imported with the heuristic
 * fallback. Nothing is discarded automatically — uncertain rows wait here.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;
  const view = parseReviewView(params.view);

  const { rows: allRows, counts } = await loadReviewQueue(supabase, core, user.id);
  const rows = filterReviewRows(allRows, view);

  const emptyCopy: Record<ReviewView, { title: string; description: string }> = {
    all: {
      title: 'Nothing needs review',
      description:
        'When an order confirmation does not add up, or we import with the fallback parser, it waits here instead of being guessed at.',
    },
    orders: {
      title: 'No orders to confirm',
      description:
        'Heuristic imports land here so you can confirm totals before they trust the dashboard.',
    },
    emails: {
      title: 'No emails stuck',
      description:
        'Failed extracts and unmatched shipping or refund updates show up here with a link back to Gmail.',
    },
  };

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <LeftRail>
        <RailGroup label="Queue">
          {REVIEW_VIEWS.map((entry) => (
            <RailItem
              key={entry.id}
              label={`${entry.label}${counts[entry.id] ? ` (${counts[entry.id]})` : ''}`}
              active={entry.id === view}
              href={reviewHref(entry.id)}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Review"
          description="Orders we could not read with confidence, and emails that never became an order. Confirm, discard, or dismiss — nothing is dropped silently."
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            // A worked queue is finished, not empty; the filtered views are
            // just narrower windows on it and stay plain.
            tone={view === 'all' ? 'finished' : 'empty'}
            seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:review`}
            title={emptyCopy[view].title}
            description={emptyCopy[view].description}
          />
        ) : (
          <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border overflow-hidden')}>
            {rows.map((row) => {
              if (row.kind === 'order') {
                return (
                  <li
                    key={row.id}
                    className="row-pad flex flex-col gap-3 px-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <Link
                          href={`/shopping/orders/${row.orderId}`}
                          className="font-medium text-ink transition-colors duration-150 hover:text-accent"
                        >
                          {row.merchantName}
                        </Link>
                        <span className="text-small font-medium uppercase tracking-wide text-caution">
                          Order to confirm
                        </span>
                      </div>
                      <p className="text-body text-ink-muted">
                        {row.orderDate}
                        {row.externalOrderNumber ? ` · #${row.externalOrderNumber}` : ''}
                        {' · '}
                        {row.itemSummary}
                      </p>
                      <p className="text-ui text-ink-muted">{row.reason}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                      <p className="tabular text-right text-body font-medium text-ink">
                        {formatMoney(row.totalCents, row.currency)}
                      </p>
                      <div className="flex flex-wrap justify-end gap-2">
                        {row.gmailHref && (
                          <a
                            href={row.gmailHref}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                          >
                            Gmail
                          </a>
                        )}
                        <Link
                          href={`/shopping/orders/${row.orderId}`}
                          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                        >
                          Open
                        </Link>
                        <ConfirmOrderButton orderId={row.orderId} />
                        <DiscardOrderButton orderId={row.orderId} />
                      </div>
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={row.id}
                  className="row-pad flex flex-col gap-3 px-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="font-medium text-ink">
                        {row.subject?.trim() || 'Email without subject'}
                      </p>
                      <span className="text-small font-medium uppercase tracking-wide text-ink-muted">
                        {classificationLabel(row.classification)}
                      </span>
                    </div>
                    <p className="text-body text-ink-muted">
                      {row.receivedAt
                        ? new Date(row.receivedAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : 'Unknown date'}
                      {row.fromAddress ? ` · ${row.fromAddress}` : ''}
                      {row.inboxEmail ? ` · via ${row.inboxEmail}` : ''}
                    </p>
                    <p className="text-ui text-ink-muted">{row.reason}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {row.linkedOrderId && (
                      <Link
                        href={`/shopping/orders/${row.linkedOrderId}`}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Linked order
                      </Link>
                    )}
                    {!row.linkedOrderId && (
                      <Link
                        href="/shopping/orders/new"
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        Add manually
                      </Link>
                    )}
                    {row.gmailHref && (
                      <a
                        href={row.gmailHref}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Open in Gmail
                      </a>
                    )}
                    <DismissEmailButton messageId={row.messageId} />
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
