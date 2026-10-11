import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { LinkedText } from '@/components/ui/linked-text';
import type { RoutineView } from '@/lib/routines/view';

/**
 * The routines of one workspace, as Dev and Goals both draw them: what each
 * does, how often it runs and when next, how its last run went, where its
 * results are, and what is still being learned about it.
 *
 * One component for both workspaces, so a routine reads the same wherever it
 * is listed. Server-rendered and without controls: the clocks are set in
 * migrations and the results pages are where a run's work is acted on.
 */
export function RoutineList({ routines }: { routines: readonly RoutineView[] }) {
  return (
    <Card>
      <ul className="divide-y divide-border">
        {routines.map((routine) => (
          <RoutineRow key={routine.key} routine={routine} />
        ))}
      </ul>
    </Card>
  );
}

function RoutineRow({ routine }: { routine: RoutineView }) {
  return (
    <li className="card-pad-x row-pad space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-ui font-semibold break-words text-ink">{routine.title}</h2>
        {routine.results && (
          <Link href={routine.results.href} className="text-small text-ink-muted underline-offset-2 hover:underline">
            {routine.results.label}
          </Link>
        )}
      </div>
      <p className="text-small break-words text-ink">{routine.does}</p>
      <p className="text-small text-ink-muted">{routine.schedule}</p>
      {routine.lastRun && (
        <p className={routine.failed ? 'text-small text-danger' : 'text-small text-ink-muted'}>{routine.lastRun}</p>
      )}
      {routine.error && (
        <p className="text-small break-words whitespace-pre-wrap text-danger">
          <LinkedText text={routine.error} />
        </p>
      )}
      {routine.warning && <p className="text-small break-words text-danger">{routine.warning}</p>}
      {routine.question && (
        // The same quiet dashed rule as fog on the plan: what is not known yet.
        <div className="border-l-2 border-dashed border-border-strong pl-2.5">
          <p className="text-micro font-semibold uppercase tracking-wide text-ink-ghost">Still being learned</p>
          <p className="whitespace-pre-wrap text-small text-ink-muted">
            <LinkedText text={routine.question} />
          </p>
        </div>
      )}
    </li>
  );
}
