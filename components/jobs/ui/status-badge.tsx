import { cn } from '@/lib/cn';
import { StatusGlyph } from '@/components/ui/status-glyph';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { APPLICATION_STATUS_GLYPHS } from '@/lib/status-glyphs';
import { statusLabel } from '@/lib/jobs/status-label';

/**
 * On this board a colour is a claim about where a pursuit stands, so the map
 * from status to colour lives in exactly one place and is used nowhere else for
 * anything else. See the status tokens in globals.css.
 *
 * The ink only, now. The badge used to be a tinted pill and the tint was
 * carrying the whole claim on its own, which meant two statuses sharing a hue
 * -- withdrawn and lead, role closed and ghosted -- were the same chip. The
 * glyph carries the claim instead, in this ink, and the label is set in
 * ordinary ink beside it.
 */
const STATUS_INK: Record<ApplicationStatus, string> = {
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
        'inline-flex shrink-0 items-center gap-1.5 text-micro font-medium text-ink',
        className,
      )}
    >
      {/* No label on the glyph: the status is written next to it, and a name
          here would make every badge read itself out twice. */}
      <StatusGlyph
        glyph={APPLICATION_STATUS_GLYPHS[status]}
        size={13}
        className={STATUS_INK[status] ?? STATUS_INK.lead}
      />
      {statusLabel(status, everSubmitted)}
    </span>
  );
}
