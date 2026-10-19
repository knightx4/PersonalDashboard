'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { archiveSubject, restoreSubject, type ArchiveState } from './actions';

/**
 * Archiving a subject and restoring it (plan #2355.2). Archive asks for no
 * confirmation, because Restore undoes it and nothing under the subject
 * changes either way. A write that fails says so under its button.
 */

type PressLook = { variant?: 'secondary' | 'ghost'; size?: 'sm' | 'md' };

function Press({ idle, busy, variant = 'secondary', size }: { idle: string; busy: string } & PressLook) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} pending={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

function PressForm({
  subjectId,
  action,
  initial,
  idle,
  busy,
  look,
  errorLine,
}: {
  subjectId: string;
  action: (prev: ArchiveState, formData: FormData) => Promise<ArchiveState>;
  initial?: ArchiveState;
  idle: string;
  busy: string;
  look?: PressLook;
  /**
   * A failed write's message on a line of its own across the whole of a
   * wrapping row, rather than under the button, so it never squeezes the
   * row's name.
   */
  errorLine?: boolean;
}) {
  const [state, run] = useActionState<ArchiveState, FormData>(action, initial ?? {});
  return (
    <>
      <form action={run} className="flex flex-col items-end gap-1">
        <input type="hidden" name="subjectId" value={subjectId} />
        <Press idle={idle} busy={busy} {...look} />
        {state.error && !errorLine && (
          <p role="alert" className="max-w-64 text-right text-small text-danger">
            {state.error}
          </p>
        )}
      </form>
      {state.error && errorLine && (
        <p role="alert" className="basis-full pb-2 text-small text-danger">
          {state.error}
        </p>
      )}
    </>
  );
}

/**
 * The Archive press in a live subject's header: quiet, beside Delete subject,
 * since both put the subject away rather than work on it.
 */
export function ArchiveSubject({ subjectId, initial }: { subjectId: string; initial?: ArchiveState }) {
  return (
    <PressForm
      subjectId={subjectId}
      action={archiveSubject}
      initial={initial}
      idle="Archive"
      busy="Archiving…"
      look={{ variant: 'ghost', size: 'sm' }}
    />
  );
}

/** Restore, on an archived subject's banner and on each row of the Archived list. */
export function RestoreSubject({
  subjectId,
  initial,
  size,
  errorLine,
}: {
  subjectId: string;
  initial?: ArchiveState;
  size?: 'sm' | 'md';
  /** In a wrapping row: the error takes a line of its own under the row. */
  errorLine?: boolean;
}) {
  return (
    <PressForm
      subjectId={subjectId}
      action={restoreSubject}
      initial={initial}
      idle="Restore"
      busy="Restoring…"
      look={{ size }}
      errorLine={errorLine}
    />
  );
}

/**
 * The top of an archived subject's page: when it was archived, what that
 * leaves it out of, and the Restore press. The page itself is unchanged
 * below it, since archiving changes nothing in the subject.
 */
export function ArchivedBanner({
  subjectId,
  archivedOn,
  initial,
}: {
  subjectId: string;
  /** The day it was archived, already worded for the person's timezone. */
  archivedOn: string;
  initial?: ArchiveState;
}) {
  return (
    <Banner tone="info" className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <p className="font-medium text-ink">Archived on {archivedOn}</p>
          <p className="text-ui text-ink-muted">
            It stays out of Now, the Subjects list and Dash&rsquo;s hourly work until you restore it. Its lessons
            and progress are kept.
          </p>
        </div>
        <RestoreSubject subjectId={subjectId} initial={initial} />
      </div>
    </Banner>
  );
}
