import Link from '@/components/ui/link';
import { matchHref, type TriageView } from '@/lib/feedback/triage';

/**
 * Jev's triage of a note or an idea, as filed (plan #1179): type, workspace,
 * priority and fix or plan on one line, a "?" on any it was not sure of, and the open item
 * it reads as a repeat of. A match is named, never merged. Nothing when the
 * row was never triaged. Drawn under a queue row, an idea, and in the header
 * panel once a note has saved.
 *
 * On a note the priority shown is Jev's first answer; the `p1`/`p2` beside the
 * date is the priority the queue works to, which a person may since have
 * changed.
 *
 * The match goes on a line of its own and in quotes (plan #1674): run on
 * after the answers, an unsure last answer read as "Plan?." and the matched
 * note's words ran into Dash's as one sentence.
 */
export function TriageNote({
  view,
  onNavigate,
}: {
  view: TriageView | null;
  /** The panel closes itself when the match is followed. */
  onNavigate?: () => void;
}) {
  if (!view) return null;
  const match = view.match ?? view.maybeMatch;
  return (
    <div className="space-y-0.5 text-small text-ink-muted">
      {view.parts.length > 0 && <p>Sorted as {view.parts.join(' · ')}</p>}
      {match && (
        <p>
          {view.match ? 'Says the same as ' : 'Might repeat '}
          <Link href={matchHref(match)} onClick={onNavigate} className="text-accent hover:underline">
            “{match.line}”
          </Link>
        </p>
      )}
    </div>
  );
}
