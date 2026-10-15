'use client';

import { useState, useTransition } from 'react';
import type { InboxRow, InboxWrite } from '@/components/inbox/inbox-page';
import { CloseButton } from '@/components/inbox/close-button';
import { buttonVariants } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { waitingEventId } from '@/lib/jobs/today/waiting';
import { prepareWithDash, type PrepareState } from '../_home/prepare-actions';

/**
 * A request from a company in the Jobs Inbox (plan #1937.9): the shape's
 * title, line, Done and Later, with Prepare for this beside Done, which
 * Today's "Waiting on you" had and the shape cannot draw, since it costs
 * and shows its $ hint.
 *
 * Done and Later go through the agenda's verbs like every other row, so the
 * request is answered on the agenda and here at once.
 */

function formOf(write: InboxWrite): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(write.fields ?? {})) form.set(key, value);
  return form;
}

export function WaitingInboxRow({
  row,
  prepare = prepareWithDash,
}: {
  row: InboxRow;
  /** Prepare for this, which Dash answers; the gallery passes one that answers at once. */
  prepare?: (eventId: string) => Promise<PrepareState>;
}) {
  const eventId = waitingEventId(row.ref);
  const done = row.verbs?.find((verb) => verb.write)?.write;
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ error?: string; message?: string }>({});
  const [prep, setPrep] = useState<PrepareState | null>(null);
  const [preparing, startPrep] = useTransition();

  const run = (write: InboxWrite) =>
    start(async () => {
      try {
        setSaid((await write.action(formOf(write))) ?? {});
      } catch {
        setSaid({ error: 'That did not go through. Try again.' });
      }
    });

  const answered = !said.error && said.message !== undefined;

  return (
    <li className="card-pad-x row-pad space-y-1.5">
      <div className="min-w-0">
        {row.href ? (
          <Link
            href={row.href}
            className="press-area block text-body font-semibold break-words text-ink hover:underline"
          >
            {row.title}
          </Link>
        ) : (
          <p className="text-body font-semibold break-words text-ink">{row.title}</p>
        )}
        {row.line && <p className="text-small break-words text-ink-muted">{row.line}</p>}
      </div>
      {answered ? (
        <p className="text-small text-positive" role="status">
          {said.message}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {done && (
            <CloseButton lifecycle="done" variant="primary" pending={pending} onClick={() => run(done)} />
          )}
          {prep?.href && !preparing ? (
            <Link href={prep.href} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              {prep.error ? 'See what went wrong' : 'Read Dash’s help'}
            </Link>
          ) : (
            eventId && (
              <DashAction
                type="button"
                size="sm"
                variant="secondary"
                pending={preparing}
                onClick={() => startPrep(async () => setPrep(await prepare(eventId)))}
                paid="app/jobs/(app)/_home/prepare-actions.ts#prepareWithDash"
                what="Cost of Dash’s help"
              >
                {preparing ? 'Dash is reading it…' : 'Prepare for this'}
              </DashAction>
            )
          )}
          {row.putOff && (
            <span className="ml-auto flex items-center gap-1">
              <CloseButton lifecycle="later" pending={pending} onClick={() => run(row.putOff!)} />
            </span>
          )}
        </div>
      )}
      <FieldError>{said.error ?? (preparing ? null : prep?.error)}</FieldError>
    </li>
  );
}
