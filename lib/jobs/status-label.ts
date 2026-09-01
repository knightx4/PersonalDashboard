/**
 * How an application status reads, kept free of the component's styling
 * (and testable directly) the same way lib/sell/price-estimate.ts splits
 * parsing from the network call around it.
 */
import type { ApplicationStatus } from './pipeline';

const LABELS: Record<ApplicationStatus, string> = {
  lead: 'Lead',
  drafting: 'Drafting',
  // Both read "Submitted": nearly everything is created from a confirmation
  // email and lands straight on `acknowledged`, so `submitted` -- sent, no
  // confirmation yet -- almost never has a row of its own, and the two were
  // one category to look at even before they shared a label.
  submitted: 'Submitted',
  acknowledged: 'Submitted',
  in_process: 'In process',
  final_round: 'Final round',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
  role_closed: 'Role closed',
};

/**
 * `withdrawn` covers two different things you did: pulled an application
 * already in flight, or turned down a lead before ever applying to it. The
 * status and the event underneath are the same either way -- only the label
 * changes, based on whether it was ever actually submitted.
 */
export function statusLabel(status: ApplicationStatus, everSubmitted = true): string {
  if (status === 'withdrawn' && !everSubmitted) return 'Turned down';
  return LABELS[status] ?? status;
}
