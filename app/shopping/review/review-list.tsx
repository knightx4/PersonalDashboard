'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  SelectionActionBar,
  SelectionCheckbox,
  SelectionProvider,
  useSelection,
  useSelectionRowClass,
} from '@/components/ui/selection';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { countNoun, useBatchWrite } from '@/lib/use-batch-write';
import { reviewSelectionTargets } from '@/lib/review/bulk';
import type { ReviewEmailRow, ReviewOrderRow, ReviewRow, ReviewView } from '@/lib/review/load';
import {
  confirmOrdersReview,
  discardOrdersReview,
  dismissEmailsReview,
  restoreDiscardedOrders,
  restoreDismissedEmails,
  unconfirmOrdersReview,
  type DiscardedOrder,
  type DismissedEmail,
} from './actions';
import { ConfirmOrderButton, DiscardOrderButton, DismissEmailButton } from './review-buttons';

function classificationLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

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

/**
 * The queue, and the selection over it.
 *
 * The header is inside the provider rather than above it, because the action
 * bar takes the header's place and has to be able to see what is ticked. That
 * is the only reason this is one component instead of the page rendering a
 * header and a list.
 */
export function ReviewQueue({
  rows,
  view,
  seed,
}: {
  rows: ReviewRow[];
  view: ReviewView;
  /** Steadies which empty-state illustration a finished queue draws. */
  seed: string;
}) {
  const selectionRows = useMemo(() => rows.map((row) => ({ key: row.id })), [rows]);

  return (
    <SelectionProvider rows={selectionRows}>
      <PageHeader
        title="Review"
        description="Orders we could not read with confidence, and emails that never became an order. Confirm, discard, or dismiss — nothing is dropped silently."
        bulk={<ReviewBulkBar rows={rows} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          // A worked queue is finished, not empty; the filtered views are
          // just narrower windows on it and stay plain.
          tone={view === 'all' ? 'finished' : 'empty'}
          seed={seed}
          title={emptyCopy[view].title}
          description={emptyCopy[view].description}
        />
      ) : (
        <ul
          className={cn(
            cardVariants({ padding: 'none' }),
            'divide-y divide-border overflow-hidden',
          )}
        >
          {rows.map((row) =>
            row.kind === 'order' ? (
              <OrderRow key={row.id} row={row} />
            ) : (
              <EmailRow key={row.id} row={row} />
            ),
          )}
        </ul>
      )}
    </SelectionProvider>
  );
}

/**
 * What the selection can be done to, each verb carrying its own count.
 *
 * Per #232: the queue interleaves orders and emails, so a mixed selection is
 * ordinary rather than a mistake, and every verb that applies to any of it is
 * offered, saying in advance how much of the selection it covers. Confirm 4
 * orders and Dismiss 2 emails sit side by side and neither touches the other's
 * rows.
 */
function ReviewBulkBar({ rows }: { rows: ReviewRow[] }) {
  const selection = useSelection();
  const { run, pending } = useBatchWrite();

  const { orderIds, emailIds } = reviewSelectionTargets(rows, (key) =>
    Boolean(selection?.isSelected(key)),
  );

  function confirmSelected() {
    run({
      ids: orderIds,
      verb: 'Confirmed',
      one: 'order',
      write: (ids) => confirmOrdersReview([...ids]),
      undo: (changed) => unconfirmOrdersReview(changed),
    });
  }

  function discardSelected() {
    // What the source messages were before the discard, which nothing can work
    // out afterwards. `write` fills it in and `undo` reads it; the undo cannot
    // run until the write is through and the toast is up.
    let restore: DiscardedOrder[] = [];
    run({
      ids: orderIds,
      verb: 'Discarded',
      one: 'order',
      write: async (ids) => {
        const result = await discardOrdersReview([...ids]);
        restore = result.restore;
        return result;
      },
      undo: () => restoreDiscardedOrders(restore),
    });
  }

  function dismissSelected() {
    // The reason each email carried, so an undo puts the row back as it read.
    let restore: DismissedEmail[] = [];
    run({
      ids: emailIds,
      verb: 'Dismissed',
      one: 'email',
      write: async (ids) => {
        const result = await dismissEmailsReview([...ids]);
        restore = result.restore;
        return result;
      },
      undo: () => restoreDismissedEmails(restore),
    });
  }

  return (
    <SelectionActionBar>
      {orderIds.length > 0 && (
        <>
          <Button type="button" size="sm" pending={pending} onClick={confirmSelected}>
            Confirm {countNoun(orderIds.length, 'order')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            pending={pending}
            onClick={discardSelected}
          >
            Discard {countNoun(orderIds.length, 'order')}
          </Button>
        </>
      )}
      {emailIds.length > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          pending={pending}
          onClick={dismissSelected}
        >
          Dismiss {countNoun(emailIds.length, 'email')}
        </Button>
      )}
    </SelectionActionBar>
  );
}

function OrderRow({ row }: { row: ReviewOrderRow }) {
  const className = useSelectionRowClass(row.id, 'row-pad flex items-start gap-3 px-4');

  return (
    <li className={className}>
      <SelectionCheckbox
        rowKey={row.id}
        label={`order from ${row.merchantName}`}
        className="mt-1"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
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
      </div>
    </li>
  );
}

function EmailRow({ row }: { row: ReviewEmailRow }) {
  const className = useSelectionRowClass(row.id, 'row-pad flex items-start gap-3 px-4');
  const subject = row.subject?.trim() || 'Email without subject';

  return (
    <li className={className}>
      <SelectionCheckbox rowKey={row.id} label={subject} className="mt-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="font-medium text-ink">{subject}</p>
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
      </div>
    </li>
  );
}
