'use client';

import { StatusGlyph } from '@/components/ui/status-glyph';
import { LIFECYCLE_GLYPH, LIFECYCLE_VERB } from '@/lib/core/lifecycle';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Note } from '@/components/ui/note';
import { PageHeader } from '@/components/shell/page-header';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import {
  SelectionActionBar,
  SelectionCheckbox,
  SelectionProvider,
  useSelection,
  useSelectionRowClass,
} from '@/components/ui/selection';
import { countNoun, useBatchWrite } from '@/lib/use-batch-write';
import {
  REVIEW_VIEWS,
  type ReviewCounts,
  type ReviewRow,
  type ReviewView,
  type SearchableRole,
} from '@/lib/jobs/review/load';
import { jobsSelectionTargets, reviewRowKey } from '@/lib/jobs/review/bulk';
import {
  acknowledgeEvents,
  dismissMessages,
  restoreDismissedMessages,
  unacknowledgeEvents,
  type DismissedMessage,
} from './actions';
import { ReviewRowBody, reviewRowLabel, useDeclineMessage } from '@/components/jobs/review/rows';
import {
  acknowledgeLateEvent,
  confirmImported,
  linkToRole,
  removeImported,
} from '@/components/jobs/review/handlers';

/**
 * Keyboard-first, because the queue is worked in bursts.
 *
 *   j / k or arrows   move between rows
 *   x                 select the row the keyboard is on
 *   esc               clear the selection
 *   1 2 3             link to the first, second or third candidate
 *   d                 dismiss
 *   enter             confirm (on an inferred application)
 *
 * Moving, selecting and clearing belong to the shared selection, and so does
 * the page's one keydown listener: the keys below arrive through its `onKey`
 * rather than through a second listener keeping a cursor of its own. x selects
 * here the way it does everywhere else, which is what #234 settled, and the
 * key that dismisses one row is now d.
 */
export function ReviewQueue({
  rows,
  counts,
  view,
  timezone,
  companyNames,
  allRoles,
}: {
  rows: ReviewRow[];
  counts: ReviewCounts;
  view: ReviewView;
  timezone: string;
  /** Every company on file, so starting a new role from a message is a pick. */
  companyNames: string[];
  /** Every pursuit on file, for linking to one the top three did not offer. */
  allRoles: SearchableRole[];
}) {
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const declineMessage = useDeclineMessage();
  const selectionRows = useMemo(() => rows.map((row) => ({ key: reviewRowKey(row) })), [rows]);

  const onKey = useCallback(
    (event: KeyboardEvent, focused: string | null) => {
      const row = rows.find((entry) => reviewRowKey(entry) === focused);
      if (!row) return;

      if (row.kind === 'message' && ['1', '2', '3'].includes(event.key)) {
        const candidate = row.candidates[Number(event.key) - 1];
        if (!candidate) return;
        event.preventDefault();
        startTransition(async () => {
          const result = await linkToRole(row.id, candidate.applicationId, candidate.label);
          setMessage(result.message);
        });
        return;
      }

      if (event.key === 'd') {
        event.preventDefault();
        if (row.kind === 'message') {
          startTransition(() => declineMessage(row));
          return;
        }
        startTransition(async () => {
          const result =
            row.kind === 'event'
              ? await acknowledgeLateEvent(row.id)
              : await removeImported(row.applicationId);
          setMessage(result.message);
        });
        return;
      }

      if (event.key === 'Enter' && row.kind === 'application') {
        event.preventDefault();
        startTransition(async () => {
          const result = await confirmImported(row.applicationId);
          setMessage(result.message);
        });
      }
    },
    [rows, declineMessage],
  );

  return (
    <SelectionProvider rows={selectionRows} onKey={onKey}>
      <PageHeader
        title="Review"
        description={`${counts.all} waiting`}
        bulk={<JobsBulkBar rows={rows} />}
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <LeftRail>
          <RailGroup label="Kind">
            {REVIEW_VIEWS.map((entry) => (
              <RailItem
                key={entry.id}
                label={entry.label}
                href={entry.id === 'all' ? '/jobs/review' : `/jobs/review?view=${entry.id}`}
                active={view === entry.id}
                count={counts[entry.id]}
              />
            ))}
          </RailGroup>
        </LeftRail>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-small text-ink-muted">
            <Kbd always announce>j</Kbd>/
            <Kbd always announce>k</Kbd> to move,{' '}
            <Kbd always announce>x</Kbd> to select,{' '}
            <Kbd always announce>1</Kbd>–
            <Kbd always announce>3</Kbd> to link,{' '}
            <Kbd always announce>d</Kbd> to dismiss.
          </p>

          {message && (
            <Note tone="accent" role="status">
              {message}
            </Note>
          )}

          {rows.map((row) => (
            <QueueRow
              key={reviewRowKey(row)}
              row={row}
              timezone={timezone}
              busy={busy}
              companyNames={companyNames}
              allRoles={allRoles}
              onDone={setMessage}
            />
          ))}
        </div>
      </div>
    </SelectionProvider>
  );
}

/**
 * Dismiss for the selected messages, Acknowledge for the selected events, each
 * saying how many rows it covers. An inferred application takes neither: what
 * to do with one is a decision about that pursuit, and its row keeps its own
 * buttons.
 */
function JobsBulkBar({ rows }: { rows: ReviewRow[] }) {
  const selection = useSelection();
  const { run, pending } = useBatchWrite();
  const { messageIds, eventIds } = jobsSelectionTargets(rows, (key) =>
    Boolean(selection?.isSelected(key)),
  );

  function dismissSelected() {
    // Everything the dismissal clears, so the undo can put it back. `write`
    // fills it in and `undo` reads it, and the undo cannot run until the write
    // is through and the toast is up.
    let restore: DismissedMessage[] = [];
    run({
      ids: messageIds,
      verb: 'Declined',
      one: 'message',
      write: async (ids) => {
        const result = await dismissMessages([...ids]);
        restore = result.restore;
        return result;
      },
      undo: () => restoreDismissedMessages(restore),
    });
  }

  function acknowledgeSelected() {
    run({
      ids: eventIds,
      verb: 'Acknowledged',
      one: 'event',
      write: (ids) => acknowledgeEvents([...ids]),
      undo: (changed) => unacknowledgeEvents(changed),
    });
  }

  return (
    <SelectionActionBar>
      {messageIds.length > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          pending={pending}
          onClick={dismissSelected}
        >
          <StatusGlyph glyph={LIFECYCLE_GLYPH.declined} />
          {LIFECYCLE_VERB.declined} {countNoun(messageIds.length, 'message')}
        </Button>
      )}
      {eventIds.length > 0 && (
        <Button type="button" size="sm" pending={pending} onClick={acknowledgeSelected}>
          Acknowledge {countNoun(eventIds.length, 'event')}
        </Button>
      )}
    </SelectionActionBar>
  );
}

function QueueRow({
  row,
  timezone,
  busy,
  companyNames,
  allRoles,
  onDone,
}: {
  row: ReviewRow;
  timezone: string;
  busy: boolean;
  companyNames: string[];
  allRoles: SearchableRole[];
  onDone: (message: string) => void;
}) {
  const key = reviewRowKey(row);
  const selection = useSelection();
  const className = useSelectionRowClass(
    key,
    cn(cardVariants({ padding: 'dense' }), 'flex items-start gap-3 transition-colors duration-quick'),
  );

  return (
    <article className={className} onClick={() => selection?.focus(key)}>
      {/* The tick box is for picking several rows with a pointer or j/k and x;
        * at 390 it held an empty strip down every card that cut the titles
        * short, so a phone gets the card's full width (law 9). */}
      <SelectionCheckbox rowKey={key} label={reviewRowLabel(row)} className="mt-0.5 hidden sm:flex" />
      <div className="min-w-0 flex-1">
        <ReviewRowBody
          row={row}
          timezone={timezone}
          busy={busy}
          companyNames={companyNames}
          allRoles={allRoles}
          onDone={(outcome) => onDone(outcome.message)}
        />
      </div>
    </article>
  );
}

