import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * The stage ink for the glyph a timeline row leads with.
 *
 * The same status tokens, stage for stage, as STATUS_INK in
 * components/jobs/ui/status-badge.tsx, so an interview reads the same amber
 * here as on the board. Kept beside the feed rather than imported because
 * that map is private to the badge; a change to one belongs in both.
 *
 * The rows used to carry a tinted chip coloured by tone, which made
 * "Interview booked" green and said nothing about the stage (plan #1755). The
 * glyph now carries the stage in its ink and the label is ordinary ink.
 */
export const STAGE_INK: Record<ApplicationStatus, string> = {
  lead: 'text-status-lead',
  drafting: 'text-status-lead',
  submitted: 'text-status-submitted',
  acknowledged: 'text-status-submitted',
  in_process: 'text-status-process',
  final_round: 'text-status-final',
  offer: 'text-status-offer',
  rejected: 'text-status-rejected',
  withdrawn: 'text-status-lead',
  ghosted: 'text-status-ghosted',
  role_closed: 'text-status-ghosted',
};
