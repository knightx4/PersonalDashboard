import Link from 'next/link';
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
    <p className="text-small text-ink-muted">
      {view.parts.length > 0 && <>Sorted as {view.parts.join(' · ')}</>}
      {match && (
        <>
          {view.parts.length > 0 ? '. ' : ''}
          {view.match ? 'Says the same as ' : 'Might repeat '}
          <Link href={matchHref(match)} onClick={onNavigate} className="text-accent hover:underline">
            {match.line}
          </Link>
        </>
      )}
    </p>
  );
}
