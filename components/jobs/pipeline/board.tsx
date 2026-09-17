'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { AlertTriangle, Ban, GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { shortAge } from '@/lib/jobs/applications/load';
import { formatCoverage, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { dismissPursuit, moveApplication } from '@/app/jobs/(app)/pipeline/actions';

/**
 * The kanban board.
 *
 * Dragging is the most-used interaction in the app, so it gets real attention:
 * the card lifts out, the target column shows where it will land, and the write
 * is optimistic so the board never stutters. A drop writes a status_override
 * EVENT — the status column itself is derived and nothing here touches it.
 *
 * 'ghosted' has no column. It is a view over silence rather than a place you
 * put things, and giving it a column would invite people to drag cards into it.
 *
 * A column is a recessed lane, not a frame. It used to be `border border-border
 * bg-canvas` holding bordered cards, where the fill was the page colour and the
 * hairline was doing all of the grouping. Moving the fill to `sunken` fixed that
 * in the light themes, where the lane reads as a proper well and the white cards
 * sit on it.
 *
 * In the dark themes it did not, and the hairline was gone by then, so the lanes
 * disappeared entirely: Ink's canvas is #08090a and its `sunken` is #050506, one
 * and a half per cent apart and well under what an eye resolves. Law 11 wants
 * space, alignment or a shared ground to do the grouping before a border does,
 * but on a near-black page there is no ground *beneath* a surface card to group
 * with -- the only step left is upward, and that is where the cards already are.
 * `sunken` cannot be lightened into the gap either: it is the chip and
 * meter-track fill in about forty other places, all of them sitting *on* a card
 * rather than under one, and lifting it to clear the canvas would sink it into
 * the surface everywhere else.
 *
 * So the hairline comes back, as the last resort law 11 describes rather than in
 * place of a ground: the fill still does the grouping wherever it can be seen,
 * and the border is what carries the lane's extent where it cannot. It is the
 * same hairline the Closed fold below is drawn with, which is the shape the rest
 * of the app uses for a section holding cards.
 *
 * Drag-over stays the accent tint alone: the lane lighting up is louder than a
 * line around it going purple, and it is legible on a phone where the border
 * never was.
 */
/**
 * `submitted` and `acknowledged` share a column, labeled by the later one:
 * nearly everything here is created from a confirmation email and lands
 * straight on `acknowledged`, so `submitted` -- sent, no confirmation yet --
 * almost never has a card in it on its own, and stayed empty as its own
 * column. `setStatus` is what a manual move or drag writes; the underlying
 * event log can still tell the two apart for anything that reads it directly.
 *
 * `final_round` folds into `in_process` the same way. The status itself, and
 * everything derived from it (analytics, rejection-stage inference), is
 * untouched -- only the board stops giving it its own column.
 */
const COLUMNS: Array<{ statuses: ApplicationStatus[]; setStatus: ApplicationStatus; label: string; hint: string }> = [
  { statuses: ['lead'], setStatus: 'lead', label: 'Leads', hint: 'Saved, not applied' },
  { statuses: ['drafting'], setStatus: 'drafting', label: 'Drafting', hint: 'You are working on it' },
  {
    statuses: ['submitted', 'acknowledged'],
    setStatus: 'acknowledged',
    label: 'Submitted',
    hint: 'Sent, and landed somewhere real',
  },
  {
    statuses: ['in_process', 'final_round'],
    setStatus: 'in_process',
    label: 'In process',
    hint: 'A human is involved',
  },
  { statuses: ['offer'], setStatus: 'offer', label: 'Offer', hint: '' },
];

/** How long a live pursuit can go quiet before the card starts saying so. */
export const STALE_DAYS = 14;

/** Closed pursuits live in one shared column so the live board stays readable. */
const CLOSED: readonly ApplicationStatus[] = ['rejected', 'withdrawn', 'ghosted', 'role_closed'];

export type PipelineView = 'board' | 'list';

export function PipelineBoard({
  rows,
  view = 'board',
}: {
  rows: PipelineRow[];
  view?: PipelineView;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ApplicationStatus | null>(null);

  /**
   * The moved card, drawn in its new column before the server agrees.
   *
   * The change is written into a copy of the rows rather than kept in a map
   * beside them, so everything on the board -- the columns, the counts, the
   * closed fold, the badge on a card -- reads one status per pursuit. A refused
   * move leaves the rows the server rendered, which is the card back in the
   * column it came from, and the hook's toast says why: there is no second
   * sentence on the board itself, because the card that moved back is what the
   * person is looking at.
   */
  const { shown, run } = useOptimisticWrite<
    PipelineRow[],
    { applicationId: string; status: ApplicationStatus }
  >({
    value: rows,
    apply: (current, change) =>
      current.map((row) =>
        row.applicationId === change.applicationId ? { ...row, status: change.status } : row,
      ),
    write: (change) => moveApplication(change.applicationId, change.status),
  });

  function drop(status: ApplicationStatus) {
    const applicationId = dragging;
    setOver(null);
    setDragging(null);
    if (!applicationId) return;

    const row = shown.find((r) => r.applicationId === applicationId);
    if (!row || row.status === status) return;

    run({ applicationId, status });
  }

  const closedRows = shown.filter((row) => CLOSED.includes(row.status));

  // The kanban board is a horizontal scroll through one and a half columns
  // on a phone, whatever view the user picked for desktop — so a phone
  // always gets the stacked, collapsible layout, and the toggle only
  // decides what sm-and-up sees.
  const renderColumns = (mode: PipelineView) =>
    COLUMNS.map((column) => {
      const columnRows = shown.filter((row) => column.statuses.includes(row.status));

      if (mode === 'list') {
        return (
          <details
            key={column.setStatus}
            open={columnRows.length > 0}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column.setStatus);
            }}
            onDragLeave={() =>
              setOver((current) => (current === column.setStatus ? null : current))
            }
            onDrop={() => drop(column.setStatus)}
            className={cn(
              'rounded-card border border-border bg-sunken transition-colors duration-150',
              over === column.setStatus && 'bg-accent-tint',
            )}
          >
            <summary className="flex cursor-pointer items-baseline gap-2 px-3 py-2">
              <span className="text-ui font-semibold text-ink">{column.label}</span>
              <span className="tabular text-ui text-ink-muted">{columnRows.length}</span>
              {column.hint && <span className="text-small text-ink-muted">{column.hint}</span>}
            </summary>
            <div className="space-y-2 px-2 pb-2">
              {columnRows.map((row) => (
                <PipelineCard
                  key={row.applicationId}
                  row={row}
                  dragging={dragging === row.applicationId}
                  onDragStart={() => setDragging(row.applicationId)}
                  onDragEnd={() => setDragging(null)}
                />
              ))}
              {columnRows.length === 0 && (
                <p className="px-1.5 py-2 text-ui text-ink-muted">Nothing here</p>
              )}
            </div>
          </details>
        );
      }

      return (
        <section
          key={column.setStatus}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(column.setStatus);
          }}
          onDragLeave={() => setOver((current) => (current === column.setStatus ? null : current))}
          onDrop={() => drop(column.setStatus)}
          className={cn(
            'w-64 shrink-0 rounded-card border border-border bg-sunken p-2 transition-colors duration-150',
            over === column.setStatus && 'bg-accent-tint',
          )}
          aria-label={column.label}
        >
          <header className="mb-2 flex items-baseline justify-between px-1.5 pt-1">
            <h2 className="text-ui font-semibold text-ink">{column.label}</h2>
            <span className="tabular text-ui text-ink-muted">{columnRows.length}</span>
          </header>
          {column.hint && (
            <p className="mb-2 px-1.5 text-small leading-snug text-ink-muted">{column.hint}</p>
          )}

          <div className="space-y-2">
            {columnRows.map((row) => (
              <PipelineCard
                key={row.applicationId}
                row={row}
                dragging={dragging === row.applicationId}
                onDragStart={() => setDragging(row.applicationId)}
                onDragEnd={() => setDragging(null)}
              />
            ))}
            {columnRows.length === 0 && (
              <p className="px-1.5 py-6 text-center text-ui text-ink-muted">Nothing here</p>
            )}
          </div>
        </section>
      );
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:hidden">{renderColumns('list')}</div>
      <div
        className={cn(
          'hidden sm:flex',
          view === 'board' ? 'gap-3 overflow-x-auto pb-2' : 'flex-col gap-2',
        )}
      >
        {renderColumns(view)}
      </div>

      {/* The shared fold. It was a hand-rolled `<details>` with its own summary
        * and no chevron, where every other fold in the app has one, and the
        * count that makes opening it a choice rather than a check now sits on
        * the closed line as the primitive's `meta`. Law 10. */}
      {closedRows.length > 0 && (
        <Card padding="dense">
          <Disclosure title="Closed" meta={`${closedRows.length} pursuit${closedRows.length === 1 ? '' : 's'}`}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {closedRows.map((row) => (
                <PipelineCard key={row.applicationId} row={row} dragging={false} muted />
              ))}
            </div>
          </Disclosure>
        </Card>
      )}
    </div>
  );
}

/** Named apart from the ui Card: this one is a pursuit, dressed in the card's classes. */
function PipelineCard({
  row,
  dragging,
  muted = false,
  onDragStart,
  onDragEnd,
}: {
  row: PipelineRow;
  dragging: boolean;
  muted?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const age = shortAge(row.lastActivityAt);
  const stale = (row.daysSinceActivity ?? 0) > STALE_DAYS;
  // Null on a role that has never been matched, which is most of them. The
  // card says nothing rather than showing 0/0 and reading as a hopeless fit.
  const coverage = formatCoverage(row.coverage);

  return (
    <article
      draggable={!muted}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        cardVariants({ interactive: !muted }),
        'group p-2.5',
        !muted && 'cursor-grab',
        dragging && 'dragging',
        muted && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-1.5">
        {!muted && (
          <GripVertical
            className="mt-0.5 size-3.5 shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            strokeWidth={1.75}
            aria-hidden
          />
        )}
        <CompanyAvatar
          company={{
            name: row.companyName,
            logoUrl: row.companyLogoUrl,
            domains: row.companyDomains,
            website: row.companyWebsite,
          }}
          className="size-7"
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/jobs/roles/${row.roleId}`}
            className="block truncate text-ui font-medium text-ink transition-colors duration-150 hover:text-accent"
          >
            {row.roleTitle}
          </Link>
          {/*
            * The company and the card's numbers share a line.
            *
            * They used to be two: the company, then a row of its own holding
            * an empty `<span />` on the left purely to push a coverage
            * fraction and a two-character age to the right. That is a whole
            * line per card spent on alignment, and eleven cards' worth of it
            * is most of a phone screen. Both are micro type; they sit beside
            * the company with room over.
            */}
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-small text-ink-muted">
              {row.companyName}
              {row.attempt > 1 && (
                <span className="ml-1 text-ink-muted">· attempt {row.attempt}</span>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {coverage && (
                <span
                  className={cn(
                    'tabular text-micro',
                    row.coverage.gaps > 0 ? 'text-caution' : 'text-ink-muted',
                  )}
                  title={`${coverage} covered by your evidence`}
                >
                  {row.coverage.covered}/{row.coverage.total}
                </span>
              )}
              {row.needsReview && (
                <AlertTriangle
                  className="size-3.5 text-caution"
                  strokeWidth={1.75}
                  aria-label="Needs review"
                />
              )}
              <span
                className={cn('tabular text-micro', stale ? 'text-caution' : 'text-ink-muted')}
                title="Time since the last thing that happened"
              >
                {age}
              </span>
            </div>
          </div>
        </div>
        {row.excitement !== null && (
          <span className="tabular shrink-0 text-small text-ink-muted" title="Excitement">
            {'★'.repeat(row.excitement)}
          </span>
        )}
        {/*
          * Gone below `sm`, not merely invisible.
          *
          * These two are `opacity-0` until the card is hovered, and a phone
          * has no hover -- so on a phone they were sixty-four unreachable
          * pixels held open on every card, and the title was truncated to pay
          * for them: "Forward Deployed Eng...", "Backend Engineer, Pay...".
          * The one thing a card exists to say was the first thing cut, for two
          * buttons nobody on that device could reach. Both actions are still
          * on the role's own page, which is one tap away.
          */}
        {!muted && (
          <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
            <QuickReject row={row} />
            <Dismiss row={row} />
          </span>
        )}
      </div>

      {row.nextAction && (
        <p className="mt-1.5 truncate rounded bg-canvas px-1.5 py-1 text-small text-ink-muted">
          {row.nextAction}
          {row.nextActionDue && <span className="ml-1 text-caution">· {row.nextActionDue}</span>}
        </p>
      )}

      {/* Only a closed card still needs a row of its own, and only for the
          badge that says which kind of closed it is. */}
      {muted && (
        <div className="mt-1.5">
          <StatusBadge status={row.status} everSubmitted={row.submittedAt !== null} />
        </div>
      )}
    </article>
  );
}

/**
 * "Send this straight to rejected."
 *
 * A rejection you already know about — a form-letter no, a posting that
 * vanished — otherwise costs a drag across every column in between, or a trip
 * to the status picker on the role page. This writes the same status_override
 * event `moveApplication` always has; it just skips the trip.
 */
function QuickReject({ row }: { row: PipelineRow }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (row.status === 'rejected') return null;

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="danger"
          size="sm"
          pending={pending}
          onClick={() =>
            startTransition(async () => {
              await moveApplication(row.applicationId, 'rejected');
              setConfirming(false);
            })
          }
        >
          {pending ? 'Moving…' : 'Reject'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Send straight to rejected"
      onClick={() => setConfirming(true)}
      className="press flex size-8 items-center justify-center rounded-lg text-ink-muted opacity-0 transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Ban className="size-4" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">Send straight to rejected</span>
    </button>
  );
}

/**
 * "This was not real."
 *
 * On the card rather than only in the review queue, because a wrongly opened
 * pursuit is most obvious exactly where you are looking at the board — and
 * once it has been confirmed, or has aged out of the queue, the queue is no
 * longer somewhere you would think to go.
 *
 * Hidden until hover so the board stays calm, but always reachable from the
 * keyboard.
 */
function Dismiss({ row }: { row: PipelineRow }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="danger"
          size="sm"
          pending={pending}
          onClick={() =>
            startTransition(async () => {
              await dismissPursuit(row.applicationId);
            })
          }
        >
          {pending ? 'Removing…' : 'Remove'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Not a real pursuit — remove it"
      onClick={() => setConfirming(true)}
      className="press flex size-8 items-center justify-center rounded-lg text-ink-muted opacity-0 transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      <X className="size-4" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">Not a real pursuit — remove it</span>
    </button>
  );
}
