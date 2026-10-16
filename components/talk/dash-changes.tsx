'use client';

import { closedToast } from '@/lib/core/lifecycle';
import { useMemo, useState, useTransition } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { Check, CircleSlash, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { CloseButton } from '@/components/inbox/close-button';
import {
  CHANGE_STATUS_LABEL,
  changeHref,
  changeWhere,
  changeWords,
} from '@/lib/ask/change-view';
import type { ChangeOutcome } from '@/lib/ask/changes';
import type { DashChange } from '@/lib/talk/changes';
import { NO_PUSH, PUSH_SETTINGS_HREF } from '@/lib/watch/start';
import { DeleteDialog } from './delete-dialog';
import { PaidCard, type PaidChange } from './paid-card';

/**
 * The changes Dash made or proposed in one answer, drawn under it (plan
 * #1190, feature #1186). Since plan #1440 Dash makes most changes when asked,
 * so a row usually arrives done: it says what was written, links to the row,
 * and offers Undo. A proposal (a watch on a price) says what would be
 * written, with Confirm and Decline, and nothing is written until Confirm.
 *
 * The presses are handed in, so the sheet, the /ask page and the surface
 * gallery each bring their own: the server actions in app/ask/actions.ts, or
 * fixtures. `onChanged` hears every change as the server now has it, so the
 * thread that owns the list keeps the latest state when the sheet re-renders.
 */

/** Confirm, decline and undo, by the change's id. Never throw. */
export type ChangePresses = {
  confirm: (id: string) => Promise<ChangeOutcome>;
  decline: (id: string) => Promise<ChangeOutcome>;
  /** The toast's Undo on Decline (plan #1957.3): proposed again. */
  reopen?: (id: string) => Promise<ChangeOutcome>;
  undo: (id: string) => Promise<ChangeOutcome>;
};

/**
 * One answer's changes, as one sunken panel with a rule between rows. What
 * costs money is gathered on its own card under them (plan #2228.2), with
 * one Accept all, so the free rows keep their own Confirm and Undo.
 */
export function DashChanges({
  changes,
  presses,
  onChanged,
  today,
}: {
  changes: readonly DashChange[];
  presses: ChangePresses;
  onChanged?: (change: DashChange) => void;
  /** YYYY-MM-DD, so a due date this year leaves the year off. */
  today?: string;
}) {
  // Kept by identity, so the card's own state is reset only by a newer list.
  const paid = useMemo(() => changes.filter((change): change is PaidChange => change.kind === 'paid_action'), [changes]);
  if (changes.length === 0) return null;
  const free = changes.filter((change) => change.kind !== 'paid_action');
  const verb = free.some((change) => change.status === 'proposed') ? 'proposed' : 'made';
  return (
    <>
      {free.length > 0 && (
        <ul
          aria-label={free.length === 1 ? `The change Dash ${verb}` : `The changes Dash ${verb}`}
          className="mt-2 divide-y divide-border rounded-card bg-sunken px-3"
        >
          {free.map((change) => (
            <li key={change.id} className="py-2.5">
              <DashChangeRow change={change} presses={presses} onChanged={onChanged} today={today} />
            </li>
          ))}
        </ul>
      )}
      {paid.length > 0 && <PaidCard changes={paid} presses={presses} onChanged={onChanged} />}
    </>
  );
}

type Press = Exclude<keyof ChangePresses, 'reopen'>;

/**
 * One change and its buttons. Keeps the change it was given until a press
 * comes back with a newer one; the Ask page's list (#1191) can draw the same
 * row for a confirmed or undone change.
 */
export function DashChangeRow({
  change: given,
  presses,
  onChanged,
  today,
  from,
}: {
  change: DashChange;
  presses: ChangePresses;
  onChanged?: (change: DashChange) => void;
  today?: string;
  /** Where the change came from, as a line under its sentence: the Ask page's list names the question. */
  from?: React.ReactNode;
}) {
  const [change, setChange] = useState(given);
  const [error, setError] = useState<string | null>(null);
  const [pressing, setPressing] = useState<Press | null>(null);
  // The "Are you sure?" popup of a proposed delete (plan #2232.2).
  const [confirming, setConfirming] = useState(false);
  const [, startPress] = useTransition();
  const toast = useToast();

  // A newer copy from the owner (a reopened thread, the other surface) wins.
  const [seen, setSeen] = useState(given);
  if (given !== seen) {
    setSeen(given);
    setChange(given);
  }

  function press(which: Press) {
    setError(null);
    setPressing(which);
    startPress(async () => {
      const outcome = await presses[which](change.id).catch(
        (): ChangeOutcome => ({ ok: false, error: 'That did not go through. Check your connection and try again.', change: null }),
      );
      setPressing(null);
      const next = outcome.change;
      if (next) {
        setChange(next);
        onChanged?.(next);
      }
      if (!outcome.ok) setError(outcome.error);
      if (outcome.ok) setConfirming(false);
      const reopen = presses.reopen;
      if (outcome.ok && which === 'decline' && reopen) {
        toast({
          text: closedToast('declined', words.what),
          undo: async () => {
            const back = await reopen(change.id);
            if (!back.ok) throw new Error(back.error);
            setChange(back.change);
            onChanged?.(back.change);
          },
        });
      }
    });
  }

  const written = change.status === 'done' || change.status === 'undone';
  const words = changeWords(change, written, today);
  const settled = change.status === 'declined' || change.status === 'undone';

  return (
    <div className="space-y-1.5">
      <p className={settled ? 'text-ui text-ink-muted' : 'text-ui text-ink'}>
        {words.verb}{' '}
        {change.status === 'done' ? (
          <Link
            href={changeHref(change)}
            className={`${linkVariants({ tone: 'inline' })} font-medium`}
          >
            {words.what}
          </Link>
        ) : (
          <span className={settled ? 'font-medium' : 'font-medium text-ink'}>{words.what}</span>
        )}
        {words.rest}
      </p>

      {from && <p className="text-small text-ink-muted">{from}</p>}

      {change.kind === 'start_watch' && !change.input.pushOn && !settled && (
        <p className="text-small text-caution">
          {NO_PUSH}{' '}
          <Link href={PUSH_SETTINGS_HREF} className={linkVariants({ tone: 'inline' })}>
            Switch push on
          </Link>{' '}
          in Account, on your phone.
        </p>
      )}

      {change.kind === 'start_build' && change.status === 'proposed' && (
        <p className="text-small text-ink-muted">
          {change.input.quiet
            ? 'Confirm writes off its quiet last run and starts a new session now.'
            : 'Confirm starts a session on this step now.'}{' '}
          It cannot be undone.
        </p>
      )}

      {change.status === 'proposed' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            pending={pressing === 'confirm'}
            disabled={pressing !== null}
            onClick={() => {
              if (change.kind === 'delete_rows') {
                setError(null);
                setConfirming(true);
              } else press('confirm');
            }}
          >
            {pressing === 'confirm' && !confirming
              ? change.kind === 'start_build'
                ? 'Starting…'
                : 'Writing…'
              : 'Confirm'}
          </Button>
          <CloseButton
            lifecycle="declined"
            variant="secondary"
            pending={pressing === 'decline'}
            disabled={pressing !== null}
            onClick={() => press('decline')}
          />
        </div>
      )}

      {change.status === 'done' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ChangeStatus change={change} />
          <Link
            href={changeHref(change)}
            className={`${linkVariants({ tone: 'inline' })} press-area text-small`}
          >
            {changeWhere(change)}
          </Link>
          {/* A started build cannot be taken back (plan #2106.1). */}
          {change.kind !== 'start_build' && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="-ml-1"
              pending={pressing === 'undo'}
              disabled={pressing !== null}
              onClick={() => press('undo')}
            >
              <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
              {pressing === 'undo' ? 'Undoing…' : 'Undo'}
            </Button>
          )}
        </div>
      )}

      {settled && <ChangeStatus change={change} />}

      {change.kind === 'delete_rows' && change.status === 'proposed' && confirming && (
        <DeleteDialog
          count={change.input.count}
          titles={change.input.titles}
          pending={pressing === 'confirm'}
          error={error}
          onDelete={() => press('confirm')}
          onCancel={() => {
            setError(null);
            setConfirming(false);
          }}
        />
      )}

      {!confirming && <FieldError>{error}</FieldError>}
    </div>
  );
}

const STATUS_NOTE: Partial<Record<DashChange['status'], string>> = {
  declined: 'Nothing was written.',
  undone: 'It was taken back.',
};

/**
 * What became of a change, as a glyph and a word. Shape as well as words, so
 * a done row and a declined one differ at a glance.
 */
export function ChangeStatus({ change }: { change: DashChange }) {
  const Glyph = change.status === 'done' ? Check : change.status === 'undone' ? Undo2 : CircleSlash;
  if (change.status === 'proposed') {
    return <span className="text-small text-ink-muted">{CHANGE_STATUS_LABEL.proposed}</span>;
  }
  const note = STATUS_NOTE[change.status];
  return (
    <span className="inline-flex items-center gap-1 text-small text-ink-muted">
      <Glyph
        className={change.status === 'done' ? 'size-3.5 text-positive' : 'size-3.5'}
        strokeWidth={1.75}
        aria-hidden
      />
      <span className={change.status === 'done' ? 'font-medium text-ink' : 'font-medium'}>
        {CHANGE_STATUS_LABEL[change.status]}
      </span>
      {note && <span>{note}</span>}
    </span>
  );
}
