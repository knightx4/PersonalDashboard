import { OvernightControl } from '@/app/dev/plan/overnight-control';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import { Card } from '@/components/ui/card';
import type { DigestNight, FeatureProgress } from '@/lib/digest/night';
import type { NotesLastRun } from '@/lib/feedback/last-worked';
import type { StoredPush } from '@/lib/plan/liveness';
import type { OvernightRun } from '@/lib/plan/overnight';

/**
 * What is running, at the top of the page you open in the morning.
 *
 * Two routines work this repository between them: one takes the plan a feature
 * at a time, the other takes the bugs and requests queue. Their states lived on
 * two different pages -- the runner's on /dev/plan, the notes routine's on
 * /dev/bugs -- so the first question of the morning, "is anything going", was
 * two pages away from the page written to answer the morning's questions.
 *
 * Called Status rather than Overnight. The runner's card has said "Overnight"
 * since it was a thing you set going before bed, and the name stayed accurate
 * only while nobody started one at eleven in the morning. Here it is one row of
 * two, so each row is named for the queue it works and the panel is named for
 * what it tells you. The digest below still says "Overnight" where it reports
 * the night that happened, which is a different fact from this one.
 *
 * One card with a rule between the rows rather than two cards: they are the
 * same kind of thing and the answer you want is both of them at once (law 11).
 */
export function StatusPanel({
  run,
  canSend,
  night,
  progress,
  push,
  ready,
  openNotes,
  notesLastRun,
}: {
  run: OvernightRun | null;
  /** Whether the deployment has the token the plan runner fires through. */
  canSend: boolean;
  night: DigestNight | null;
  /** How far the night is through the feature it is on. */
  progress: FeatureProgress | null;
  push: StoredPush | null;
  /** Features the plan runner could pick up now. The card's own note says how. */
  ready: number;
  /** Outstanding notes, so "run it" is an answerable question. */
  openNotes: number;
  /** What the notes routine did last, so the row says something between runs. */
  notesLastRun: NotesLastRun | null;
}) {
  return (
    <Card padding="dense" className="space-y-3">
      <h2 className="text-ui font-semibold text-ink">Status</h2>
      <OvernightControl
        run={run}
        canSend={canSend}
        night={night}
        progress={progress}
        refreshReadings
        push={push}
        ready={ready}
        label="Plan"
        bare
      />
      <div className="border-t border-border pt-3">
        <RunRoutineButton
          openCount={openNotes}
          allHref="/dev/bugs"
          divider="none"
          lastRun={notesLastRun}
        />
      </div>
    </Card>
  );
}
