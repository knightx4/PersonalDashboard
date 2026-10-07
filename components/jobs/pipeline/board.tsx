'use client';

import Link from 'next/link';
import { useImperativeHandle, useLayoutEffect, useRef, useState, useTransition, type Ref } from 'react';
import { AlertTriangle, Ban, GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { ScoreLine } from '@/components/jobs/ui/score-figures';
import { MoveLabel } from '@/components/ui/move-label';
import { applicationMove } from '@/lib/jobs/move';
import { rowRef, withRun } from '@/lib/core/move';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { shortAge } from '@/lib/jobs/applications/load';
import { formatCoverage, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { useOptimisticWrite, type WriteResult } from '@/lib/use-optimistic-write';
import {
  boardMoment,
  OPEN_STATUSES,
  openApplications,
  stillOpenLine,
  type BoardMoment,
} from '@/lib/jobs/board-moment';
import { completionMoment } from '@/components/motion/complete';
import { useToast } from '@/components/ui/toast';
import {
  CARD_ATTR,
  LANE_ATTR,
  fadeInPlace,
  glideBoard,
  playForward,
  playOffer,
  readLayout,
  visibleCard,
  type BoardLayout,
} from './moments';
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
/**
 * Each stage's heading is its name and count only (law 15). What the stage
 * means is said once, by its empty state, where there is nothing else to read.
 */
const COLUMNS: Array<{ statuses: ApplicationStatus[]; setStatus: ApplicationStatus; label: string; empty: string }> = [
  { statuses: ['lead'], setStatus: 'lead', label: 'Leads', empty: 'No roles saved and not yet applied for' },
  { statuses: ['drafting'], setStatus: 'drafting', label: 'Drafting', empty: 'Nothing being written' },
  {
    statuses: ['submitted', 'acknowledged'],
    setStatus: 'acknowledged',
    label: 'Submitted',
    empty: 'Nothing sent and waiting',
  },
  {
    statuses: ['in_process', 'final_round'],
    setStatus: 'in_process',
    label: 'In process',
    empty: 'No process with a person in it yet',
  },
  { statuses: ['offer'], setStatus: 'offer', label: 'Offer', empty: 'No offers yet' },
];

/** Whether a status has a column on the board; a closed one leaves it. */
function isOnBoard(status: ApplicationStatus): boolean {
  return COLUMNS.some((column) => column.statuses.includes(status));
}

/** How long a live pursuit can go quiet before the card starts saying so. */
export const STALE_DAYS = 14;

/**
 * The board is the live applications only (plan #1590). A closed one has no
 * column: the page leaves it out, and a card rejected here fades and goes.
 * The closed applications are a status filter on the table, a page at a time,
 * where they used to be a fold under the board drawing every one as a card.
 */
/**
 * A move made from outside the board, through the same path a drag or the
 * reject button takes, so its moment plays. The gallery's moment demos use it
 * (plan #1596): a recording at phone width has no drag to make.
 */
export type BoardHandle = {
  move: (applicationId: string, status: ApplicationStatus) => void;
};

export function PipelineBoard({
  rows,
  working = [],
  openCount,
  handle,
  write = moveApplication,
}: {
  rows: PipelineRow[];
  /**
   * How many applications are open across the whole pipeline, for the line a
   * rejection leaves. The rows can be a filtered few, and the line counts
   * every open one. Counted from the rows when left out.
   */
  openCount?: number;
  /** Refs an open Ask Dash hand-off is about (plan #1568); those cards read "Dash is on it". */
  working?: readonly string[];
  handle?: Ref<BoardHandle>;
  /**
   * The write a move makes. The server action, except in the gallery, which
   * keeps the move in its own rows so the card stays where it went.
   */
  write?: (applicationId: string, status: ApplicationStatus) => Promise<WriteResult>;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ApplicationStatus | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  /**
   * The move waiting to play its moment (plans #1560, #1596): which card,
   * which moment, and where everything on the board stood before it redrew.
   */
  const moving = useRef<{
    applicationId: string;
    moment: BoardMoment;
    status: ApplicationStatus;
    before: BoardLayout;
    column: string;
    company: string;
  } | null>(null);
  /**
   * The sentence a rejection leaves, waiting for its write to go through:
   * where the role went, and how many applications are still open. Said in
   * the toast, which moves nothing on the board, and only once the write has
   * worked, so a refused move never claims it was filed.
   */
  const closedLines = useRef(new Map<string, string>());
  const toast = useToast();

  /**
   * The moved card, drawn in its new column before the server agrees.
   *
   * The change is written into a copy of the rows rather than kept in a map
   * beside them, so everything on the board -- the columns, the counts, the
   * badge on a card -- reads one status per pursuit. A refused
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
    write: (change) => write(change.applicationId, change.status),
    // An offer is a completion: the buzz once the write is through.
    onDone: (change) => {
      if (change.status === 'offer') completionMoment();
      const line = closedLines.current.get(change.applicationId);
      if (line) {
        closedLines.current.delete(change.applicationId);
        toast({ text: line });
      }
    },
  });

  /**
   * Play the waiting move's moment once the card has been drawn in its new
   * column: before paint, so the card is never seen there first and then
   * jumping back to travel.
   */
  useLayoutEffect(() => {
    const pending = moving.current;
    if (!pending) return;
    const row = shown.find((r) => r.applicationId === pending.applicationId);
    if (pending.moment === 'rejection') {
      if (row && isOnBoard(row.status)) return;
      moving.current = null;
      void glideBoard(boardRef.current, pending.before);
      return;
    }
    if (!row || row.status !== pending.status) return;
    moving.current = null;
    const card =
      visibleCard(boardRef.current, pending.applicationId) ??
      openFoldFor(boardRef.current, pending.applicationId);
    if (!card) return;
    if (pending.moment === 'offer') void playOffer(boardRef.current, card, pending.before, pending.company);
    else void playForward(boardRef.current, card, pending.before, pending.column);
  }, [shown]);

  /**
   * Move a card, with the moment the move calls for. A rejection fades the
   * card where it stands before the write takes it off the board, the lane
   * closes up after it, and the toast says how many applications are still
   * open. Every other move glides the board from where it stood.
   */
  async function move(row: PipelineRow, status: ApplicationStatus) {
    const moment = boardMoment(row.status, status);
    if (moment === 'rejection') {
      await fadeInPlace(visibleCard(boardRef.current, row.applicationId));
      const open = openCount ?? openApplications(shown);
      const wasOpen = OPEN_STATUSES.includes(row.status);
      closedLines.current.set(
        row.applicationId,
        stillOpenLine(row.companyName, Math.max(0, open - (wasOpen ? 1 : 0))),
      );
      moving.current = {
        applicationId: row.applicationId,
        moment,
        status,
        before: readLayout(boardRef.current),
        column: '',
        company: row.companyName,
      };
    } else if (moment) {
      const target = COLUMNS.find((column) => column.statuses.includes(status));
      const source = COLUMNS.find((column) => column.statuses.includes(row.status));
      if (target && target !== source) {
        moving.current = {
          applicationId: row.applicationId,
          moment,
          status,
          before: readLayout(boardRef.current),
          column: target.label,
          company: row.companyName,
        };
      }
    }
    run({ applicationId: row.applicationId, status });
  }

  useImperativeHandle(
    handle,
    () => ({
      move: (applicationId, status) => {
        const row = shown.find((r) => r.applicationId === applicationId);
        if (row && row.status !== status) void move(row, status);
      },
    }),
  );

  function drop(status: ApplicationStatus) {
    const applicationId = dragging;
    setOver(null);
    setDragging(null);
    if (!applicationId) return;

    const row = shown.find((r) => r.applicationId === applicationId);
    if (!row || row.status === status) return;

    void move(row, status);
  }

  // The kanban board is a horizontal scroll through one and a half columns
  // on a phone, so a phone gets the stacked, collapsible layout and sm and
  // up gets the columns side by side.
  const renderColumns = (mode: 'board' | 'list') =>
    COLUMNS.map((column) => {
      const columnRows = shown.filter((row) => column.statuses.includes(row.status));

      if (mode === 'list') {
        return (
          // A wrapper for the drop target and the tint, and the shared fold
          // inside it, kept per column in this browser (plan #1432).
          <div
            key={column.setStatus}
            {...{ [LANE_ATTR]: column.setStatus }}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column.setStatus);
            }}
            onDragLeave={() =>
              setOver((current) => (current === column.setStatus ? null : current))
            }
            onDrop={() => drop(column.setStatus)}
            className={cn(
              // Its own stacking context, so the heading below can sit over
              // a card gliding in without rising over the page's own bars.
              'isolate rounded-card bg-sunken transition-colors duration-quick',
              over === column.setStatus && 'bg-accent-tint',
            )}
          >
            {/* The heading is drawn on the lane's own ground and over the
              * cards, so a card gliding into this lane from the one above
              * passes under the stage's name rather than across it. */}
            <Disclosure
              remember={`jobs.fold.pipeline.${column.setStatus}`}
              defaultOpen={columnRows.length > 0}
              summaryClassName={cn(
                'relative z-20 rounded-card px-3 py-2 transition-colors duration-quick',
                over === column.setStatus ? 'bg-accent-tint' : 'bg-sunken',
              )}
              bodyClassName="space-y-2 px-2 pb-2"
              title={column.label}
              meta={
<span className="tabular text-ui">{columnRows.length}</span>
              }
            >
              {columnRows.map((row) => (
                <PipelineCard
                  key={row.applicationId}
                  working={working}
                  row={row}
                  dragging={dragging === row.applicationId}
                  onDragStart={() => setDragging(row.applicationId)}
                  onDragEnd={() => setDragging(null)}
                  onReject={() => move(row, 'rejected')}
                />
              ))}
              {columnRows.length === 0 && (
                <p className="px-1.5 py-2 text-ui text-ink-muted">{column.empty}</p>
              )}
            </Disclosure>
          </div>
        );
      }

      // A stage with nothing in it is a narrow lane: still somewhere to drop
      // a card, without holding a full column open for nothing. The stages
      // with cards share the rest, so at a laptop's width the board fits
      // without scrolling sideways.
      const empty = columnRows.length === 0;
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
            'rounded-card bg-sunken p-2 transition-colors duration-quick',
            empty ? 'w-36 shrink-0' : 'min-w-60 flex-1',
            over === column.setStatus && 'bg-accent-tint',
          )}
          aria-label={column.label}
          data-stage={column.setStatus}
          {...{ [LANE_ATTR]: column.setStatus }}
        >
          <header className="mb-2 flex items-baseline justify-between px-1.5 pt-1">
            <h2 className="text-ui font-semibold text-ink">{column.label}</h2>
            <span className="tabular text-ui text-ink-muted">{columnRows.length}</span>
          </header>

          <div className="space-y-2">
            {columnRows.map((row) => (
              <PipelineCard
                key={row.applicationId}
                working={working}
                row={row}
                dragging={dragging === row.applicationId}
                onDragStart={() => setDragging(row.applicationId)}
                onDragEnd={() => setDragging(null)}
                onReject={() => move(row, 'rejected')}
              />
            ))}
            {empty && (
              <p className="px-1.5 py-6 text-center text-small text-ink-muted">{column.empty}</p>
            )}
          </div>
        </section>
      );
    });

  return (
    <div ref={boardRef} className="space-y-4">
      <div className="flex flex-col gap-2 sm:hidden">{renderColumns('list')}</div>
      {/* The five stages do not fit side by side at a laptop's width, so the
        * board says what is off to the right (law 2): every stage by name and
        * count on one line above it, each scrolling its column into view, and
        * the last visible column fading at the edge. */}
      <nav aria-label="Stages" className="hidden flex-wrap items-baseline gap-x-4 gap-y-1 text-small sm:flex">
        {COLUMNS.map((column) => (
          <button
            key={column.setStatus}
            type="button"
            onClick={() =>
              boardRef.current
                ?.querySelector(`[data-stage="${column.setStatus}"]`)
                ?.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'smooth' })
            }
            className="text-ink-muted transition-colors duration-quick hover:text-accent"
          >
            {column.label}{' '}
            <span className="tabular text-ink">
              {shown.filter((row) => column.statuses.includes(row.status)).length}
            </span>
          </button>
        ))}
      </nav>
      <div className="scroll-fade-x hidden gap-3 overflow-x-auto pb-2 sm:flex">
        {renderColumns('board')}
      </div>
    </div>
  );
}

/**
 * On a phone each stage is a fold, and a card moved into one the person had
 * closed would land out of sight with nothing to play on. Open that fold, so
 * the card is seen arriving, and hand back the card. Null when the stacked
 * layout is not the one on screen.
 */
function openFoldFor(root: HTMLElement | null, applicationId: string): HTMLElement | null {
  if (!root) return null;
  const selector = `[${CARD_ATTR}="${CSS.escape(applicationId)}"]`;
  for (const card of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    const fold = card.closest('details');
    if (fold && !fold.open && fold.getClientRects().length > 0) {
      fold.open = true;
      return visibleCard(root, applicationId);
    }
  }
  return null;
}

/** Named apart from the ui Card: this one is a pursuit, dressed in the card's classes. */
function PipelineCard({
  row,
  dragging,
  muted = false,
  onDragStart,
  onDragEnd,
  onReject,
  working,
}: {
  row: PipelineRow;
  dragging: boolean;
  muted?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Send it straight to rejected, through the board so the rejection plays. */
  onReject?: () => Promise<void>;
  working?: readonly string[];
}) {
  const age = shortAge(row.lastActivityAt);
  const stale = (row.daysSinceActivity ?? 0) > STALE_DAYS;
  // Null on a role that has never been matched, which is most of them. The
  // card says nothing rather than showing 0/0 and reading as a hopeless fit.
  const coverage = formatCoverage(row.coverage);
  // Whose move it is (plan #1454). Null on a closed card, whose badge says it.
  // "Dash is on it" while an Ask Dash hand-off about it is open (plan #1568).
  const move = withRun(
    applicationMove({
      status: row.status,
      lastEvent: row.lastTurnEvent,
      companyName: row.companyName,
    }),
    working,
    [rowRef('job_search.applications', row.applicationId), rowRef('job_search.roles', row.roleId)],
  );

  return (
    <article
      {...{ [CARD_ATTR]: row.applicationId }}
      draggable={!muted}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        cardVariants({ interactive: !muted }),
        // Tight at the left, with the grip laid over the edge rather than
        // beside the logo, so the title starts as far left as it can (note
        // 7e3a17d3).
        'group relative py-2 pr-2 pl-1.5',
        !muted && 'cursor-grab',
        dragging && 'dragging',
        muted && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-1.5">
        {!muted && (
          <GripVertical
            className="absolute top-1/2 -left-1 size-3 -translate-y-1/2 text-ink-muted opacity-0 transition-opacity duration-quick group-hover:opacity-100"
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
          {/* The stars share the title's line, so the line below runs the
            * full width and every card's age ends on the same right edge
            * (law 18). Beside the card they took two to five stars' width
            * and moved the age with them. */}
          <div className="flex items-baseline justify-between gap-2">
            {/* Padded out to a finger's height and pulled back by the same
              * margin, so the title is a 44px target on a phone without the
              * card growing. */}
            <Link
              href={`/jobs/roles/${row.roleId}`}
              className="-my-3.5 block min-w-0 truncate py-3.5 text-small font-medium text-ink transition-colors duration-quick hover:text-accent"
            >
              {row.roleTitle}
            </Link>
            {row.excitement !== null && (
              <span className="tabular shrink-0 text-small text-ink-muted" title="Excitement">
                {'★'.repeat(row.excitement)}
              </span>
            )}
          </div>
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
          <ScoreLine note={row.scoreNote} />
          {move && <MoveLabel move={move.move} title={move.title} className="mt-0.5 max-w-full" />}
        </div>
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
          // Laid over the card's top right corner rather than beside it, so
          // the invisible pair holds no width at a laptop: the stars and the
          // age end on the card's own edge there too (law 18).
          <span className="absolute top-1 right-1 hidden items-center gap-0.5 rounded-lg focus-within:bg-surface group-hover:bg-surface sm:flex">
            {onReject && <QuickReject row={row} onReject={onReject} />}
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
 * event `moveApplication` always has; it just skips the trip. It goes through
 * the board's move, so the card fades where it is and the board says how many
 * applications are still open (plan #1560).
 */
function QuickReject({ row, onReject }: { row: PipelineRow; onReject: () => Promise<void> }) {
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
              await onReject();
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
      className="press flex size-8 items-center justify-center rounded-lg text-ink-muted opacity-0 transition-colors duration-quick hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
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
      className="press flex size-8 items-center justify-center rounded-lg text-ink-muted opacity-0 transition-colors duration-quick hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      <X className="size-4" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">Not a real pursuit — remove it</span>
    </button>
  );
}
