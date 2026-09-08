'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { Select } from '@/components/ui/field';
import { statusLabel } from '@/lib/jobs/status-label';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { moveApplication } from '@/app/jobs/(app)/pipeline/actions';

/**
 * The status, where you are already looking at it.
 *
 * Dragging a card on the board is a fine way to move one pursuit and a poor
 * way to move the one you happen to be reading about on a company page. This
 * is the same action underneath -- it writes the manual override event and
 * lets the database recompute the status from the event log -- so a change
 * made here is indistinguishable from a change made on the board.
 *
 * `ghosted` is missing on purpose: it is worked out from silence, and the
 * action refuses it. Offering an option that always errors is worse than not
 * offering it.
 *
 * `submitted` is missing too, on purpose: it and `acknowledged` share a
 * label and a column on the board, so offering both here would be two
 * identical-looking options. Picking "Submitted" writes `acknowledged`.
 */
const SETTABLE = APPLICATION_STATUSES.filter((status) => status !== 'ghosted' && status !== 'submitted');

/** `submitted` and `acknowledged` are one option here; see SETTABLE above. */
function displayStatus(status: ApplicationStatus): ApplicationStatus {
  return status === 'submitted' ? 'acknowledged' : status;
}

export function StatusPicker({
  applicationId,
  status,
  submittedAt = null,
  className,
}: {
  applicationId: string;
  status: ApplicationStatus;
  /** Null for a lead or draft never submitted — see statusLabel. */
  submittedAt?: string | null;
  className?: string;
}) {
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic, so the select does not snap back to the old value while the
  // server round trip and the revalidation happen.
  const [shown, setShown] = useState<ApplicationStatus>(displayStatus(status));
  const everSubmitted = submittedAt !== null;

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {/* The primitive, shrunk to the row it sits in: a status is chrome, not a form field. */}
      <Select
        value={shown}
        disabled={busy}
        aria-label="Status"
        onChange={(event) => {
          const next = event.target.value as ApplicationStatus;
          const previous = shown;
          setShown(next);
          setError(null);
          startTransition(async () => {
            const result = await moveApplication(applicationId, next);
            if (result.error) {
              setShown(previous);
              setError(result.error);
            }
          });
        }}
        className="h-7 w-auto px-1.5 text-small"
      >
        {SETTABLE.map((option) => (
          <option key={option} value={option}>
            {statusLabel(option, everSubmitted)}
          </option>
        ))}
      </Select>
      {error && (
        <span role="alert" className="text-small text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
