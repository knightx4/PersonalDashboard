import { OvernightControl } from '@/app/dev/plan/overnight-control';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import { Card } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { SectionFold } from '@/components/ui/disclosure';
import type { GoalsStatus } from '@/lib/goals/runner-status';
import type { NotesLastRun } from '@/lib/feedback/last-worked';
import { overnightStanding, type OvernightRun } from '@/lib/plan/overnight';
import type { RunnerCard } from '@/lib/plan/runner-card';
import type { VisionReviewStatus } from '@/lib/specs/vision-review-run';
import { VisionReviewLine } from './vision-review-line';

/**
 * What is running, at the top of the page you open in the morning.
 *
 * Two routines work this repository between them: one takes the plan a feature
 * at a time, the other takes the bugs and requests queue. Their states lived on
 * two different pages -- the runner's on /dev/plan, the notes routine's on
 * /dev/bugs -- so the first question of the morning, "is anything going", was
 * two pages away from the page written to answer the morning's questions.
 *
 * Its heading is Controls now, folded shut under the strip of chips at the
 * top of Home (now-strip.tsx), which says what this card used to say first.
 * The card keeps the presses: start, hold, run the notes.
 *
 * Called Status rather than Overnight, before that. The runner's card has said "Overnight"
 * since it was a thing you set going before bed, and the name stayed accurate
 * only while nobody started one at eleven in the morning. Here it is one row of
 * two, so each row is named for the queue it works and the panel is named for
 * what it tells you. The digest below still says "Overnight" where it reports
 * the night that happened, which is a different fact from this one.
 *
 * Below them, the weekly vision review (plan #1108). It has no button because
 * it runs by itself, but when it last ran belongs with the other routines.
 *
 * One card with a rule between the rows rather than two cards: they are the
 * same kind of thing and the answer you want is both of them at once (law 11).
 */
export function StatusPanel({
  run,
  canSend,
  card,
  goals,
  openNotes,
  notesLastRun,
  vision,
  autoApprove,
  now,
}: {
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
}) {
  return (
    <Card padding="dense">
      {/* Shut to begin with: the strip above says what is running, and this
          card is where it is started, held or run by hand. */}
      <SectionFold remember="dev.fold.controls" title="Controls" defaultOpen={false}>
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
            // Dash's own mark (note 414ead16), working while the plan runner
            // is firing and resting otherwise, so "is anything going" is
            // answered before the rows are read. Under Plan on the left, and
            // larger than the icon it was beside the heading (note 076e7744).
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
      </SectionFold>
    </Card>
  );
}
