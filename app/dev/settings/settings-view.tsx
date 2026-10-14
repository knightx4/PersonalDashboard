import { OvernightControl } from '@/app/dev/plan/overnight-control';
import { VisionReviewLine } from '@/app/dev/raised/vision-review-line';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import { SettingsPage } from '@/components/patterns/settings-page';
import { DashMark } from '@/components/ui/dash-mark';
import type { GoalsStatus } from '@/lib/goals/runner-status';
import type { NotesLastRun } from '@/lib/feedback/last-worked';
import { overnightStanding, type OvernightRun } from '@/lib/plan/overnight';
import type { RunnerCard } from '@/lib/plan/runner-card';
import type { VisionReviewStatus } from '@/lib/specs/vision-review-run';

export type DevSettingsProps = {
  run: OvernightRun | null;
  /** Whether the deployment has the token the plan runner fires through. */
  canSend: boolean;
  /** What the runner's card says, as `runnerCard` reads it for both pages. */
  card: RunnerCard;
  /** The goals half of the same runner, or null when it could not be read. */
  goals: GoalsStatus | null;
  /** Outstanding notes, so "run it" is an answerable question. */
  openNotes: number;
  /** What the notes routine did last, so the row says something between runs. */
  notesLastRun: NotesLastRun | null;
  /** The weekly vision review's last run, or null when it could not be read. */
  vision: VisionReviewStatus | null;
  /** Whether auto approve is on, for its switch on the Plan row. */
  autoApprove: boolean;
  now: number;
};

/**
 * Dev settings (plan #1937.10): the routines that work this repository, and
 * the switches that steer them.
 *
 * They were the Controls card folded under the strip at the top of Home,
 * where the strip already says what is running; the presses that start, hold
 * and set them belong with settings. One section, since the three rows are
 * the same kind of thing and the answer wanted is all of them at once (law
 * 11): the plan runner with its auto approve switch and the goals half of the
 * same night, the notes routine, and the weekly vision review, which runs by
 * itself and has no button. The runner's card on /dev/plan is unchanged.
 */
export function DevSettingsView({
  run,
  canSend,
  card,
  goals,
  openNotes,
  notesLastRun,
  vision,
  autoApprove,
  now,
}: DevSettingsProps) {
  return (
    <SettingsPage
      title="Dev settings"
      href="/dev/settings"
      sections={[
        {
          id: 'routines',
          title: 'Routines',
          content: (
            <div className="space-y-3">
              <OvernightControl
                run={run}
                canSend={canSend}
                night={card.night}
                on={card.on}
                sessions={card.sessions}
                progress={card.progress}
                refreshReadings
                push={card.push}
                ready={card.ready}
                readySteps={card.readySteps}
                goals={goals}
                next={card.next}
                fresh
                label="Plan"
                // Dash's own mark (note 414ead16), working while the plan
                // runner is firing and resting otherwise, under Plan on the
                // left (note 076e7744).
                mark={
                  <DashMark
                    size="md"
                    state={overnightStanding(run) === 'running' ? 'working' : 'idle'}
                    className="text-accent"
                  />
                }
                bare
                showBlocked={false}
                autoApprove={autoApprove}
              />
              <div className="border-t border-border pt-3">
                <RunRoutineButton
                  openCount={openNotes}
                  allHref="/dev/bugs"
                  divider="none"
                  lastRun={notesLastRun}
                />
              </div>
              {vision && (
                <div className="border-t border-border pt-3">
                  <VisionReviewLine status={vision} now={now} />
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
