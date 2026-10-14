import Link, { linkVariants } from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { cn } from '@/lib/cn';
import { formatDate, formatInterviewWhen } from '@/lib/jobs/applications/load';
import type { ClosestApplication, ClosestRound } from '@/lib/jobs/today/closest';
import { HomeSection } from './home-section';

const LINK = cn(linkVariants({ tone: 'quiet' }), 'press-area text-small');

/** The role's Interviews tab, open on one round's first conversation, where its prep and notes are. */
function roundHref(roleId: string, round: ClosestRound): string {
  return `/jobs/roles/${roleId}?tab=interviews&interview=${round.leadId}`;
}

/**
 * The applications at final round or in process, first on Now, one row each
 * with where the next round stands (lib/jobs/today/closest.ts).
 *
 * Three lines under the name, each left out when it has nothing to say: the
 * next round, its prep, and what the earlier rounds left on record. Now asks
 * for nothing (plan #1937.9), so a round still owed a debrief is no longer
 * called out here; the Earlier line's count says how many are written up.
 * Nothing at all when no application is this close (law 1).
 */
export function ClosestSection({
  closest,
  timezone,
}: {
  closest: readonly ClosestApplication[];
  timezone: string;
}) {
  if (closest.length === 0) return null;
  return (
    <HomeSection id="closest" title="Closest to an offer">
      <Card padding="dense">
        <ul className="divide-y divide-border">
          {closest.map((app) => (
            <li key={app.applicationId} className="row-pad space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <Link
                  href={`/jobs/roles/${app.roleId}`}
                  className="press-area text-ui font-medium text-ink transition-colors duration-quick hover:text-accent"
                >
                  {app.companyName} · {app.roleTitle}
                </Link>
                <span className="text-small text-ink-muted">{app.stage}</span>
              </div>
              <ValueList className="space-y-1">
                <Line term="Next round">
                  {app.next ? (
                    <span className="text-ink">
                      <span className="tabular">
                        {formatInterviewWhen(app.next.scheduledAt, app.next.timeKnown, timezone)}
                      </span>
                      {app.next.label && <span className="text-ink-muted"> · {app.next.label}</span>}
                    </span>
                  ) : (
                    <span className="text-ink-muted">No round booked</span>
                  )}
                </Line>
                <Prep app={app} timezone={timezone} />
                <Earlier app={app} />
              </ValueList>
            </li>
          ))}
        </ul>
      </Card>
    </HomeSection>
  );
}

function Line({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <ValueRow label={term} value={children} />
  );
}

/**
 * The next round's prep, yours or Dash's. With no round booked there is
 * nothing to prepare yet, so the line points at the last prep written, or is
 * left out.
 */
function Prep({ app, timezone }: { app: ClosestApplication; timezone: string }) {
  if (app.next) {
    return (
      <Line term="Prep">
        {app.next.prepped ? (
          <Link href={roundHref(app.roleId, app.next)} className={LINK}>
            Open the prep
          </Link>
        ) : (
          <Link href={roundHref(app.roleId, app.next)} className={LINK}>
            None yet
          </Link>
        )}
      </Line>
    );
  }
  if (!app.earlierPrep) return null;
  return (
    <Line term="Prep">
      <Link href={roundHref(app.roleId, app.earlierPrep)} className={LINK}>
        From {app.earlierPrep.label ?? 'the last round'},{' '}
        {formatDate(app.earlierPrep.scheduledAt, timezone)}
      </Link>
    </Line>
  );
}

/** What the rounds already over left on record: a count, and the first question asked. */
function Earlier({ app }: { app: ClosestApplication }) {
  const { rounds, written, questions, firstQuestion } = app.earlier;
  if (rounds === 0) return null;
  const count = `${rounds} ${rounds === 1 ? 'round' : 'rounds'}, ${
    written === rounds ? (rounds === 1 ? 'written up' : 'all written up') : `${written} written up`
  }`;
  return (
    <Line term="Earlier">
      <Link href={`/jobs/roles/${app.roleId}?tab=interviews`} className={LINK}>
        {count}
      </Link>
      {firstQuestion && (
        <span className="block truncate text-ink-muted" title={firstQuestion}>
          Asked: {firstQuestion}
          {questions > 1 && ` (and ${questions - 1} more)`}
        </span>
      )}
    </Line>
  );
}
