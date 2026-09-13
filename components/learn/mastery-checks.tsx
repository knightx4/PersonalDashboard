import { Check, CircleDashed, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { standingOf, type CheckStanding } from '@/lib/learn/graph/probe-payload';

/**
 * The checks that say what understanding a claim looks like.
 *
 * Shown in two places and written once: under a claim on an approval screen,
 * where refusing a bad check is still possible, and on the concept's own page
 * afterwards. Both are reading positions rather than editing ones, so the
 * checks sit in the same small muted type the basis already uses and do not
 * compete with the claim above them.
 *
 * On the concept page each check also says how it has gone, which is what
 * makes the bar legible: a second question about a check you have already got
 * right moves it a fraction of what the first one did. An approval screen
 * passes no answers -- nothing has been asked at that point -- and shows the
 * plain list.
 *
 * Spans rather than a `ul`, with the list semantics put back by `role`. Two of
 * the call sites render inside a span already, and a list inside phrasing
 * content is markup a browser is entitled to do anything it likes with.
 */

const STANDING_LABEL: Record<CheckStanding, string> = {
  right: 'Got it right',
  missed: 'Missed it',
  untouched: 'Not asked about yet',
};

function StandingMark({ standing }: { standing: CheckStanding }) {
  const shared = 'size-3.5 shrink-0 translate-y-0.5';
  if (standing === 'right') {
    return <Check className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
  }
  if (standing === 'missed') {
    return <X className={cn(shared, 'text-danger')} strokeWidth={2} aria-hidden />;
  }
  return <CircleDashed className={cn(shared, 'text-ink-muted')} strokeWidth={2} aria-hidden />;
}

export function MasteryChecks({
  checks,
  answers,
  className,
}: {
  checks: string[];
  /**
   * The questions asked about this concept, when there are any to mark from.
   * Left out on a screen where nothing has been asked yet.
   */
  answers?: readonly {
    masteryCheck: string | null;
    chosenIndex: number | null;
    correctIndex: number;
  }[];
  className?: string;
}) {
  if (checks.length === 0) {
    // Said rather than left blank: a concept nobody wrote checks for is a
    // concept whose questions will be written against the claim in general,
    // and that is worth knowing before you approve it.
    return (
      <span className={cn('block text-small text-ink-muted', className)}>
        No checks were written for this one.
      </span>
    );
  }

  return (
    <span role="list" className={cn('block space-y-0.5', className)}>
      {checks.map((check) => {
        const standing = answers ? standingOf(check, answers) : null;

        return (
          <span key={check} role="listitem" className="flex gap-1.5 text-small text-ink-muted">
            {standing === null ? <span aria-hidden>•</span> : <StandingMark standing={standing} />}
            <span>
              {check}
              {standing !== null && (
                <span className={cn('ml-2', standing === 'missed' ? 'text-danger' : 'text-ink-muted')}>
                  {STANDING_LABEL[standing]}
                </span>
              )}
            </span>
          </span>
        );
      })}
    </span>
  );
}
