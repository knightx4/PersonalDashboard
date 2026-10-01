'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Check, CircleSlash, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import {
  CHANGE_STATUS_LABEL,
  changeHref,
  changeWhere,
  changeWords,
} from '@/lib/ask/change-view';
import type { ChangeOutcome } from '@/lib/ask/changes';
import type { DashChange } from '@/lib/talk/changes';
import { NO_PUSH, PUSH_SETTINGS_HREF } from '@/lib/watch/start';

/**
 * The changes Dash proposed in one answer, drawn under it (plan #1190,
 * feature #1186). Each is a row saying what would be written and where, with
 * Confirm and Decline; after a press the row says what happened, links to the
 * row it wrote, and offers Undo. Nothing is written until Confirm.
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
  undo: (id: string) => Promise<ChangeOutcome>;
};

/** One answer's changes, as one sunken panel with a rule between rows. */
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
  if (changes.length === 0) return null;
  return (
    <ul
      aria-label={changes.length === 1 ? 'The change Dash proposed' : 'The changes Dash proposed'}
      className="mt-2 divide-y divide-border rounded-card bg-sunken px-3"
    >
      {changes.map((change) => (
        <li key={change.id} className="py-2.5">
          <DashChangeRow change={change} presses={presses} onChanged={onChanged} today={today} />
        </li>
      ))}
    </ul>
  );
}

type Press = keyof ChangePresses;

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
  const [, startPress] = useTransition();

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
    });
  }

  const written = change.status === 'confirmed' || change.status === 'undone';
  const words = changeWords(change, written, today);
  const settled = change.status === 'declined' || change.status === 'undone';

  return (
    <div className="space-y-1.5">
      <p className={settled ? 'text-ui text-ink-muted' : 'text-ui text-ink'}>
        {words.verb}{' '}
        {change.status === 'confirmed' ? (
          <Link
            href={changeHref(change)}
            className="font-medium text-accent underline-offset-2 hover:underline"
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
          <Link href={PUSH_SETTINGS_HREF} className="text-accent underline-offset-2 hover:underline">
            Switch push on
          </Link>{' '}
          in Account, on your phone.
        </p>
      )}

      {change.status === 'proposed' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            pending={pressing === 'confirm'}
            disabled={pressing !== null}
            onClick={() => press('confirm')}
          >
            {pressing === 'confirm' ? 'Writing…' : 'Confirm'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pending={pressing === 'decline'}
            disabled={pressing !== null}
            onClick={() => press('decline')}
          >
            Decline
          </Button>
        </div>
      )}

      {change.status === 'confirmed' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ChangeStatus change={change} />
          <Link
            href={changeHref(change)}
            className="text-small text-accent underline-offset-2 hover:underline"
          >
            {changeWhere(change)}
          </Link>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-ml-1"
            pending={pressing === 'undo'}
            disabled={pressing !== null}
            onClick={() => press('undo')}
          >
            <Undo2 className="size-3.5" strokeWidth={2} aria-hidden />
            {pressing === 'undo' ? 'Undoing…' : 'Undo'}
          </Button>
        </div>
      )}

      {settled && <ChangeStatus change={change} />}

      <FieldError>{error}</FieldError>
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
  const Glyph = change.status === 'confirmed' ? Check : change.status === 'undone' ? Undo2 : CircleSlash;
  if (change.status === 'proposed') {
    return <span className="text-small text-ink-muted">{CHANGE_STATUS_LABEL.proposed}</span>;
  }
  const note = STATUS_NOTE[change.status];
  return (
    <span className="inline-flex items-center gap-1 text-small text-ink-muted">
      <Glyph
        className={change.status === 'confirmed' ? 'size-3.5 text-positive' : 'size-3.5'}
        strokeWidth={2}
        aria-hidden
      />
      <span className={change.status === 'confirmed' ? 'font-medium text-ink' : 'font-medium'}>
        {CHANGE_STATUS_LABEL[change.status]}
      </span>
      {note && <span>{note}</span>}
    </span>
  );
}
