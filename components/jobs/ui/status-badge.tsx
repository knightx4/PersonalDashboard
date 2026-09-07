import { cn } from '@/lib/cn';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { statusLabel } from '@/lib/jobs/status-label';

/**
 * On this board a colour is a claim about where a pursuit stands, so the map
 * from status to colour lives in exactly one place and is used nowhere else for
 * anything else. See the status tokens in globals.css.
 */
const STATUS_CLASSNAMES: Record<ApplicationStatus, string> = {
  lead: 'bg-status-lead-tint text-status-lead',
  drafting: 'bg-status-lead-tint text-status-lead',
  submitted: 'bg-status-submitted-tint text-status-submitted',
  acknowledged: 'bg-status-submitted-tint text-status-submitted',
  in_process: 'bg-status-process-tint text-status-process',
  final_round: 'bg-status-final-tint text-status-final',
  offer: 'bg-status-offer-tint text-status-offer',
  rejected: 'bg-status-rejected-tint text-status-rejected',
  withdrawn: 'bg-status-lead-tint text-status-lead',
  ghosted: 'bg-status-ghosted-tint text-status-ghosted',
  role_closed: 'bg-status-ghosted-tint text-status-ghosted',
};

export function StatusBadge({
  status,
  everSubmitted = true,
  className,
}: {
  status: ApplicationStatus;
  /** Set false for a lead or draft withdrawn before it was ever submitted. */
  everSubmitted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-micro font-medium',
        STATUS_CLASSNAMES[status] ?? STATUS_CLASSNAMES.lead,
        className,
      )}
    >
      {statusLabel(status, everSubmitted)}
    </span>
  );
}

/** The dot form, for table rows where a full badge is too heavy. */
export function StatusDot({ status }: { status: ApplicationStatus }) {
  const label = statusLabel(status);
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        STATUS_CLASSNAMES[status] ?? STATUS_CLASSNAMES.lead,
      )}
      title={label}
      aria-label={label}
    />
  );
}
