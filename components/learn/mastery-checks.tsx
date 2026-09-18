import { Check, CircleDashed, X } from 'lucide-react';
import { RUNG_LABEL } from '@/components/learn/concept-state';
import { cn } from '@/lib/cn';
import {
  standingOf,
  type AskedRung,
  type CheckStanding,
  type Rung,
} from '@/lib/learn/graph/probe-payload';

/**
 * The checks that say what understanding a claim looks like.
 *
 * Shown in two places and written once: under a claim on an approval screen,
 * where refusing a bad check is still possible, and on the concept's own page
 * afterwards. Both are reading positions rather than editing ones, so the
 * checks sit in the same small muted type the basis already uses and do not
 * compete with the claim above them.
 *
 * On the concept page each check also says how it has gone at each rung, which
 * is what the ladder is for: getting a check right out of four options and
 * using it in a case you have not seen are different things shown, and one
 * mark per check could only say one of them. An approval screen passes no
 * answers -- nothing has been asked at that point -- and shows the plain list.
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

/**
 * Which rungs get a line under each check.
 *
 * The two that can be asked, always, so a check nobody has applied says so
 * rather than going quiet. The defence rung is in the enum and nothing writes
 * a question at it yet, so it appears only once something has been asked
 * there: a rung that cannot be reached reads as a gap you could close, and it
 * is not one.
 */
function rungsToMark(answers: readonly AskedRung[]): Rung[] {
  const rungs: Rung[] = ['recognise', 'apply'];
  if (answers.some((probe) => probe.rung === 'defend')) rungs.push('defend');
  return rungs;
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
  answers?: readonly AskedRung[];
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

  if (!answers) {
    return (
      <span role="list" className={cn('block space-y-0.5', className)}>
        {checks.map((check) => (
          <span key={check} role="listitem" className="flex gap-1.5 text-small text-ink-muted">
            <span aria-hidden>•</span>
            <span>{check}</span>
          </span>
        ))}
      </span>
    );
  }

  const rungs = rungsToMark(answers);

  return (
    <span role="list" className={cn('block space-y-2', className)}>
      {checks.map((check) => (
        <span key={check} role="listitem" className="block text-small text-ink-muted">
          {check}
          <span className="mt-0.5 block space-y-0.5 pl-4">
            {rungs.map((rung) => {
              const standing = standingOf(check, rung, answers);

              return (
                <span key={rung} className="flex gap-1.5">
                  <StandingMark standing={standing} />
                  <span>
                    {RUNG_LABEL[rung]}
                    <span
                      className={cn(
                        'ml-2',
                        standing === 'missed' ? 'text-danger' : 'text-ink-muted',
                      )}
                    >
                      {STANDING_LABEL[standing]}
                    </span>
                  </span>
                </span>
              );
            })}
          </span>
        </span>
      ))}
    </span>
  );
}
