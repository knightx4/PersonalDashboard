import Link from 'next/link';
import { CircleHelp, Flag, ListChecks, Megaphone, Sparkles, User } from 'lucide-react';
import { FileBody } from '@/components/files/file-body';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { Meter } from '@/components/ui/meter';
import type { Brief } from '@/lib/goals/briefs';
import { formatDay } from '@/lib/goals/dates';
import { claudeLine, type GoalStatusView, type StatusRowKind } from '@/lib/goals/goal-status';
import { stagesLabel, stageWait, type Stage } from '@/lib/goals/goal-page';
import type { GoalReview } from '@/lib/goals/reviews';
import { VerdictLabel } from '../goal-line';

/**
 * The top of a goal's page (lib/goals/goal-status.ts, plan #1078): Dash's
 * status for the day, its latest note or the status's reason, the next move
 * with its date, a track of the stages, and, folded, everything on the goal
 * that is waiting on you, each opening where it is done lower on the page.
 */

const ROW_ICONS: Record<StatusRowKind, typeof User> = {
  question: CircleHelp,
  flag: Megaphone,
  approve: Flag,
  read: Sparkles,
  do: User,
};

export type GoalStatusCardProps = {
  status: GoalStatusView;
  brief: Brief | null;
  /** When the note was written, to follow "written": "today", "on 3 Oct". */
  briefWhen: string | null;
  review: GoalReview | null;
  /** Whether that status is recent enough to stand as today's (isCurrent). */
  current: boolean;
  /** The goal's stages, for the track along the foot; null for a goal that is one list. */
  stages: Stage[] | null;
};

export function GoalStatusCard({ status, brief, briefWhen, review, current, stages }: GoalStatusCardProps) {
  const dash = claudeLine(status);
  const waiting = status.yourMove.length + status.moreSteps;
  return (
    <section aria-labelledby="status-heading">
      <Card padding="standard" className="space-y-3">
        <h2 id="status-heading" className="sr-only">
          Where it stands
        </h2>
        {review ? (
          <VerdictLabel review={review} current={current} />
        ) : (
          <p className="text-small text-ink-muted">Dash has not checked this goal yet.</p>
        )}

        {brief ? (
          <div className="space-y-1">
            <FileBody markdown={brief.body} compact />
            {briefWhen && <p className="text-small text-ink-muted">Dash’s note, written {briefWhen}</p>}
          </div>
        ) : (
          review && <p className="text-ui text-ink">{review.reason}</p>
        )}
        {review && (
          <p className="text-small text-ink-muted">
            Next: <span className="text-ink">{review.nextMove}</span>
            {review.nextOn && `, ${formatDay(review.nextOn)}`}
          </p>
        )}

        {stages && <StageTrack stages={stages} />}

        {waiting > 0 && (
          <Disclosure title="Waiting on you" meta={waiting}>
            <ul className="space-y-1">
              {status.yourMove.map((row) => {
                const Icon = row.kind === 'approve' && row.href.startsWith('#step-') ? ListChecks : ROW_ICONS[row.kind];
                return (
                  <li key={`${row.kind}-${row.id}`}>
                    <Link
                      href={row.href}
                      className="press -mx-1 flex items-start gap-2 rounded-control px-1 py-0.5 text-small hover:bg-sunken"
                    >
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                      <span className="min-w-0 flex-1 break-words text-ink">
                        <span className="font-medium">{row.label}:</span> {row.title}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {status.moreSteps > 0 && (
                <li className="pl-5 text-small text-ink-muted">
                  {status.moreSteps === 1 ? '1 more step' : `${status.moreSteps} more steps`} of yours in the stages
                </li>
              )}
            </ul>
          </Disclosure>
        )}

        {dash && <p className="text-small text-ink-muted">{dash}</p>}
      </Card>
    </section>
  );
}

/**
 * The stages as one bar of segments: a finished stage full, each stage under
 * way filled as far as its steps are done, the rest empty. The first and last
 * stages are named under it, so the bar reads as the way from one to the
 * other.
 */
function StageTrack({ stages }: { stages: Stage[] }) {
  const label = stagesLabel(stages);
  return (
    <div className="space-y-1">
      <div className="flex gap-1" role="img" aria-label={label}>
        {stages.map((stage) =>
          stage.state === 'current' ? (
            <Meter
              key={stage.id}
              value={stage.done}
              max={stage.live}
              fill="bg-positive"
              track="sunken"
              minFraction={0.15}
              label={`${stage.title}: ${stage.done} of ${stage.live} done`}
              className="flex-1"
            />
          ) : (
            <span
              key={stage.id}
              title={[stage.title, stageWait(stage)].filter(Boolean).join(': ')}
              className={`h-1.5 flex-1 rounded-full ${stage.state === 'done' ? 'bg-positive' : 'bg-sunken'}`}
            />
          ),
        )}
      </div>
      <div className="flex justify-between gap-3 text-small text-ink-ghost">
        <span className="min-w-0 truncate">{stages[0].title}</span>
        <span className="min-w-0 truncate text-right">{stages[stages.length - 1].title}</span>
      </div>
    </div>
  );
}
