'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { CommentCount } from '@/components/dev/comment-count';
import { Thread } from '@/components/thread/thread';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { DashMark } from '@/components/ui/dash-mark';
import Link from '@/components/ui/link';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import type { DevComment } from '@/lib/comments/load';
import { whenDate } from '@/lib/core/when';
import { accountHref } from '@/lib/finances/accounts';
import { REVIEW_SEEN_COOKIE, REVIEW_SEEN_MAX_AGE } from '@/lib/finances/review/seen';
import type { ReviewCharge, ReviewPanel, ShownLine, ShownReview } from '@/lib/finances/review/show';
import { formatMoney } from '@/lib/money';
import { threadRef } from '@/lib/thread/subjects';
import { usePopover } from '@/lib/use-popover';
import { tryMonthReviewAgain } from './actions';

const UTC = { timeZone: 'UTC' } as const;

/**
 * The monthly money review at the top of Finances (plan #2593.8.3), as Dash
 * wrote it on the first of the month (plan #2593.8.2).
 *
 * Open on the first visit in the month and closed after: the page reads a
 * cookie this sets once the review has been shown open. Closed, it keeps
 * the month and Dash's opening on one line, so what the month came to is
 * still there to glance at.
 *
 * Each line is a press that opens what is behind it: a popover of the
 * largest charges, each opening its account, or of the accounts net worth
 * is about; a line about one account, such as a payment due, opens it.
 * One thread sits under the whole review, since a line is a sentence in a
 * row rather than a row of its own.
 *
 * A month with nothing in it is one sentence. A failed run says Dash could
 * not write it, offers Try again, and lists the code's own sentences when
 * the run had worked them out. Before the first review, a line says when it
 * comes.
 *
 * `openLine`, `retrying` and `error` hold a hidden part open for the
 * gallery's shots.
 */
export function MonthReview({
  panel,
  thread,
  defaultOpen,
  today,
  openLine,
  retrying = false,
  error: givenError = null,
}: {
  panel: NonNullable<ReviewPanel>;
  thread: DevComment[];
  /** Whether this month's review has not been shown open on this device. */
  defaultOpen: boolean;
  today: string;
  openLine?: string;
  retrying?: boolean;
  error?: string | null;
}) {
  if (panel.kind === 'first') {
    return (
      <Card padding="standard" className="mb-6 flex items-start gap-3">
        <DashMark size="sm" tone="brand" decorative />
        <p className="text-ui text-ink-muted">
          <span className="font-medium text-ink">
            Your first monthly review comes on {dayName(panel.on)}.
          </span>{' '}
          Dash writes it from {panel.label}: what you spent against the months before, subscriptions
          that started or changed, interest, and payments coming due.
        </p>
      </Card>
    );
  }
  const { review } = panel;
  if (review.state === 'failed') {
    return (
      <FailedReview review={review} today={today} retrying={retrying} givenError={givenError} />
    );
  }
  if (review.state === 'quiet') {
    return (
      <Card padding="standard" className="mb-6 flex items-start gap-3">
        <DashMark size="sm" tone="brand" decorative />
        <p className="pt-0.5 text-ui text-ink">
          {review.summary ?? `Nothing came through your accounts in ${review.label}.`}
        </p>
      </Card>
    );
  }
  return (
    <WrittenReview
      review={review}
      thread={thread}
      defaultOpen={defaultOpen}
      today={today}
      openLine={openLine}
    />
  );
}

/** "1 November". */
function dayName(day: string): string {
  return whenDate(day, { ...UTC, month: 'long', year: 'never' });
}

function WrittenReview({
  review,
  thread,
  defaultOpen,
  today,
  openLine,
}: {
  review: ShownReview;
  thread: DevComment[];
  defaultOpen: boolean;
  today: string;
  openLine?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  // Shown open once is enough: the next visit this month starts closed.
  useEffect(() => {
    if (!open) return;
    try {
      document.cookie = `${REVIEW_SEEN_COOKIE}=${review.month}; path=/finances; max-age=${REVIEW_SEEN_MAX_AGE}; samesite=lax`;
    } catch {
      // A browser that refuses the cookie opens it every visit, which is harmless.
    }
  }, [open, review.month]);

  return (
    <Card padding="none" className="mb-6">
      <section aria-labelledby={`${bodyId}-heading`}>
        <h2 id={`${bodyId}-heading`} className="text-ui">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((was) => !was)}
            className="press card-pad-x flex w-full items-start gap-3 rounded-card py-3 text-left hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <DashMark size="sm" tone="brand" decorative />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-semibold text-ink">{review.label}</span>
                <span className="text-small font-normal text-ink-muted">Dash’s review</span>
                <CommentCount count={thread.length} />
              </span>
              {!open && review.summary && (
                <span className="mt-0.5 block truncate font-normal text-ink-muted">
                  {review.summary}
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                'mt-1 size-4 shrink-0 text-ink-muted transition-transform duration-quick',
                open && 'rotate-180',
              )}
            />
          </button>
        </h2>
        <div id={bodyId} hidden={!open} className="card-pad-x space-y-3 pb-4">
          {review.summary && (
            <p className="voice-dash px-3 py-2 text-body text-ink">{review.summary}</p>
          )}
          <ReviewLines lines={review.lines} today={today} openLine={openLine} />
          <div className="border-t border-border pt-3">
            <Thread
              subject={threadRef('review', review.id)}
              turns={thread}
              placeholder={`A note on ${review.label}, or a question for Dash.`}
            />
          </div>
        </div>
      </section>
    </Card>
  );
}

function ReviewLines({
  lines,
  today,
  openLine,
}: {
  lines: readonly ShownLine[];
  today: string;
  openLine?: string;
}) {
  return (
    <ul className="-mx-2">
      {lines.map((line) => (
        <ReviewLine key={line.id} line={line} today={today} defaultOpen={openLine === line.id} />
      ))}
    </ul>
  );
}

/** What a line's press says it opens: "12 charges", "Sapphire Preferred ••4417". */
function lineTarget(line: ShownLine): string | null {
  if (line.chargeCount > 0)
    return line.chargeCount === 1 ? '1 charge' : `${line.chargeCount} charges`;
  if (line.accounts.length === 1) return line.accounts[0].title;
  if (line.accounts.length > 1) return `${line.accounts.length} accounts`;
  return null;
}

/**
 * One line of the review. With something behind it, the line is a press
 * that opens the popover; a line with nothing to open is plain text.
 */
function ReviewLine({
  line,
  today,
  defaultOpen,
}: {
  line: ShownLine;
  today: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });
  const target = lineTarget(line);

  if (!target) {
    return (
      <li className="px-2 py-2">
        <p className="text-body text-ink">{line.text}</p>
      </li>
    );
  }

  // One account and no charges, such as a payment due: the line opens it.
  if (line.chargeCount === 0 && line.accounts.length === 1) {
    return (
      <li>
        <Link
          href={accountHref(line.accounts[0].id)}
          className="press flex w-full items-start gap-3 rounded-control px-2 py-2 text-left hover:bg-sunken focus-visible:outline-2"
        >
          <span className="min-w-0 flex-1 text-body text-ink">{line.text}</span>
          <span className="mt-0.5 flex max-w-40 shrink-0 items-center gap-0.5 text-small text-ink-muted">
            <span className="truncate">{target}</span>
            <ChevronRight aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
          </span>
        </Link>
      </li>
    );
  }

  return (
    <li className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'press flex w-full items-start gap-3 rounded-control px-2 py-2 text-left hover:bg-sunken focus-visible:outline-2',
          open && 'bg-sunken',
        )}
      >
        <span className="min-w-0 flex-1 text-body text-ink">{line.text}</span>
        <span className="mt-0.5 flex max-w-40 shrink-0 items-center gap-0.5 text-small text-ink-muted">
          <span className="truncate">{target}</span>
          <ChevronRight aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
        </span>
      </button>
      {open && (
        <Popover
          ref={panelRef}
          id={panelId}
          anchor="trigger-below"
          padding="menu"
          role="dialog"
          aria-label={`Behind: ${line.text}`}
          tabIndex={-1}
          className="right-0 sm:left-auto sm:w-96"
        >
          {line.chargeCount > 0 ? (
            <ChargeList line={line} today={today} />
          ) : (
            <ul>
              {line.accounts.map((account) => (
                <li key={account.id}>
                  <Link
                    href={accountHref(account.id)}
                    className="press flex min-h-11 items-center justify-between gap-3 rounded-control px-2.5 py-1.5 text-ui text-ink hover:bg-sunken"
                  >
                    <span className="truncate">{account.title}</span>
                    <ChevronRight
                      aria-hidden
                      strokeWidth={1.75}
                      className="size-3.5 shrink-0 text-ink-muted"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      )}
    </li>
  );
}

/** A charge as a list reads it: what went out plain, what came back with a plus. */
function amount(cents: number): string {
  return cents > 0 ? `+${formatMoney(cents)}` : formatMoney(Math.abs(cents));
}

function ChargeList({ line, today }: { line: ShownLine; today: string }) {
  const rest = line.chargeCount - line.charges.length;
  return (
    <div>
      <ul>
        {line.charges.map((charge) => (
          <ChargeRow key={charge.id} charge={charge} today={today} />
        ))}
      </ul>
      {(rest > 0 || line.chargeCount > 1) && (
        <p className="flex justify-between gap-3 border-t border-border px-2.5 pb-1 pt-2 text-small text-ink-muted">
          <span>
            {rest > 0
              ? `${rest} smaller ${rest === 1 ? 'charge' : 'charges'} not listed`
              : `${line.chargeCount} charges`}
          </span>
          <span className="tabular">{amount(line.totalCents)} in all</span>
        </p>
      )}
    </div>
  );
}

function ChargeRow({ charge, today }: { charge: ReviewCharge; today: string }) {
  return (
    <li>
      <Link
        href={accountHref(charge.accountId)}
        className="press flex min-h-11 items-center gap-3 rounded-control px-2.5 py-1.5 text-ui hover:bg-sunken"
      >
        <span className="tabular w-12 shrink-0 text-small text-ink-muted">
          {whenDate(charge.postedOn, { ...UTC, year: 'auto', now: today })}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink">
          {charge.name}
          {charge.pending && <span className="text-ink-muted"> · Pending</span>}
        </span>
        <span className={cn('tabular shrink-0', charge.amountCents > 0 ? 'text-good' : 'text-ink')}>
          {amount(charge.amountCents)}
        </span>
      </Link>
    </li>
  );
}

/**
 * A run that broke. Says so, offers Try again (one Sonnet call, priced
 * beside it), and keeps the code's own sentences when the run got that far.
 */
function FailedReview({
  review,
  today,
  retrying,
  givenError,
}: {
  review: ShownReview;
  today: string;
  retrying: boolean;
  givenError: string | null;
}) {
  const [error, setError] = useState<string | null>(givenError);
  const [pending, start] = useTransition();
  const router = useRouter();
  const tries =
    review.attempts === 1 ? 'once' : review.attempts === 2 ? 'twice' : `${review.attempts} times`;
  return (
    <Card padding="standard" className="mb-6 space-y-3">
      <div className="flex items-start gap-3">
        <DashMark size="sm" tone="brand" decorative />
        <div className="min-w-0 flex-1 space-y-1" role="alert">
          <h2 className="text-ui font-semibold text-ink">
            Dash couldn’t write the review of {review.label}
          </h2>
          <p className="text-ui text-ink-muted">
            {review.gaveUp
              ? `It tried ${tries} and has stopped trying on its own.`
              : `It tried ${tries} and tries again tomorrow.`}
            {review.lines.length > 0 && ' The figures it had worked out are below.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 pl-9">
        <DashAction
          type="button"
          variant="secondary"
          size="sm"
          pending={pending || retrying}
          paid="app/finances/accounts/actions.ts#tryMonthReviewAgain"
          what="Cost of writing the review again"
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await tryMonthReviewAgain(review.month);
              if (result.error) setError(result.error);
              router.refresh();
            })
          }
        >
          {pending || retrying ? 'Writing the review' : 'Try again'}
        </DashAction>
        {error && <p className="text-small text-danger">{error}</p>}
      </div>
      {review.lines.length > 0 && <ReviewLines lines={review.lines} today={today} />}
    </Card>
  );
}
