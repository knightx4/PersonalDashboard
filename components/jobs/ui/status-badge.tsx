import { cn } from '@/lib/cn';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * On this board a colour is a claim about where a pursuit stands, so the map
 * from status to colour lives in exactly one place and is used nowhere else for
 * anything else. See the status tokens in globals.css.
 */
const STATUS_STYLES: Record<ApplicationStatus, { label: string; className: string }> = {
  lead: { label: 'Lead', className: 'bg-status-lead-tint text-status-lead' },
  drafting: { label: 'Drafting', className: 'bg-status-lead-tint text-status-lead' },
  // Both read "Submitted": nearly everything is created from a confirmation
  // email and lands straight on `acknowledged`, so `submitted` -- sent, no
  // confirmation yet -- almost never has a row of its own, and the two were
  // one category to look at even before they shared a label.
  submitted: { label: 'Submitted', className: 'bg-status-submitted-tint text-status-submitted' },
  acknowledged: {
    label: 'Submitted',
    className: 'bg-status-submitted-tint text-status-submitted',
  },
  in_process: { label: 'In process', className: 'bg-status-process-tint text-status-process' },
  final_round: { label: 'Final round', className: 'bg-status-final-tint text-status-final' },
  offer: { label: 'Offer', className: 'bg-status-offer-tint text-status-offer' },
  rejected: { label: 'Rejected', className: 'bg-status-rejected-tint text-status-rejected' },
  withdrawn: { label: 'Withdrawn', className: 'bg-status-lead-tint text-status-lead' },
  ghosted: { label: 'Ghosted', className: 'bg-status-ghosted-tint text-status-ghosted' },
  role_closed: { label: 'Role closed', className: 'bg-status-ghosted-tint text-status-ghosted' },
};

export function statusLabel(status: ApplicationStatus): string {
  return STATUS_STYLES[status]?.label ?? status;
}

export function StatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.lead;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}

/** The dot form, for table rows where a full badge is too heavy. */
export function StatusDot({ status }: { status: ApplicationStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.lead;
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', style.className)}
      title={style.label}
      aria-label={style.label}
    />
  );
}
