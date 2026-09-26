import Link from 'next/link';
import { CircleHelp, Flag, ListChecks, Megaphone, Sparkles, User } from 'lucide-react';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { FileBody } from '@/components/files/file-body';
import { Card } from '@/components/ui/card';
import type { Brief } from '@/lib/goals/briefs';
import { claudeLine, type GoalStatusView, type StatusRowKind } from '@/lib/goals/goal-status';
import { VERDICT_LABELS, type GoalReview, type Verdict } from '@/lib/goals/reviews';

/**
 * The top of a goal's page (lib/goals/goal-status.ts): Claude's latest note on
 * where the goal stands, the weekly verdict, and everything on the goal that
 * is waiting on you, each opening where it is done lower on the page. With no
 * note yet, the weekly verdict's reason and next move stand in for it.
 */

const ROW_ICONS: Record<StatusRowKind, typeof User> = {
  question: CircleHelp,
  flag: Megaphone,
  approve: Flag,
  read: Sparkles,
  do: User,
};

const VERDICT_TONES: Record<Verdict, DevTone> = {
  on_track: 'positive',
  stalled: 'caution',
  waiting_on_you: 'caution',
};

export type GoalStatusCardProps = {
  status: GoalStatusView;
  brief: Brief | null;
  /** When the note was written, to follow "written": "today", "on 3 Oct". */
  briefWhen: string | null;
  review: GoalReview | null;
};

export function GoalStatusCard({ status, brief, briefWhen, review }: GoalStatusCardProps) {
  const dash = claudeLine(status);
  return (
    <section aria-labelledby="status-heading">
      <Card padding="standard" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 id="status-heading" className="text-ui font-semibold text-ink">
            Where it stands
          </h2>
          {review && (
            <StateLabel
              glyph={null}
              word={VERDICT_LABELS[review.verdict]}
              tone={VERDICT_TONES[review.verdict]}
              title="The weekly check's verdict"
              className="text-small font-semibold"
            />
          )}
        </div>

        {brief ? (
          <div className="space-y-1">
            <FileBody markdown={brief.body} compact />
            {briefWhen && <p className="text-small text-ink-muted">Claude’s note, written {briefWhen}</p>}
          </div>
        ) : (
          review && (
            <div className="space-y-0.5 text-small text-ink">
              <p>{review.reason}</p>
              <p className="text-ink-muted">Next: {review.nextMove}</p>
            </div>
          )
        )}

        <div className="space-y-1">
          <h3 className="text-small font-semibold text-ink-muted">Your move</h3>
          {status.yourMove.length === 0 ? (
            <p className="text-small text-ink-muted">Nothing on this goal is waiting on you.</p>
          ) : (
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
                  {status.moreSteps === 1 ? '1 more step' : `${status.moreSteps} more steps`} of yours in the tree
                </li>
              )}
            </ul>
          )}
        </div>

        {dash && <p className="text-small text-ink-muted">{dash}</p>}
      </Card>
    </section>
  );
}
