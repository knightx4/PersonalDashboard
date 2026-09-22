import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { SweepOutcome } from '@/lib/vault/map/sweep';
import type { SweepView } from '@/lib/vault/map/sweep-read';
import { startSweep, stopSweep } from './actions';

/**
 * The sweep's state on the map page (plan #757): what it has reached, what
 * happened to each note and why, and the one button that applies.
 *
 * A server component with plain forms. The sweep moves every five minutes,
 * not every second, so the page shows where it stood when it was loaded.
 */

/** In the order a reader wants them: what was read, then why the rest were not. */
const OUTCOME_LINES: { outcome: SweepOutcome; label: string }[] = [
  { outcome: 'read', label: 'read into the map' },
  { outcome: 'nothing', label: 'read, and argue nothing the map can hold' },
  { outcome: 'record', label: 'judged a record rather than an argument, so only the opening was read' },
  { outcome: 'unchanged', label: 'unchanged since an earlier sweep, so not read again' },
  { outcome: 'journal', label: 'in Me, so never sent' },
  { outcome: 'excluded', label: 'in Career/Job Applications, so never sent' },
  { outcome: 'credential', label: 'contain what looks like an API key, so never sent' },
  { outcome: 'too_short', label: 'under 80 characters, so never sent' },
  { outcome: 'reading', label: 'being read now' },
  { outcome: 'failed', label: 'failed' },
];

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

export function SweepPanel({ sweep }: { sweep: SweepView | null }) {
  if (!sweep) {
    return (
      <section className={cn(cardVariants(), 'mb-4 p-4')} aria-labelledby="sweep-heading">
        <h2 id="sweep-heading" className="text-body font-semibold text-ink">
          Sweep every note
        </h2>
        <p className="mt-1 text-ui text-ink-muted">
          Reads every note in your vault the way a note&rsquo;s Map section does and writes what
          it finds to the map. Notes in Me, notes with API keys and notes under 80 characters are
          skipped, and so is Career/Job Applications. It runs in the background a few minutes at a time, carries on after you close
          this page, and can be stopped.
        </p>
        <form action={startSweep} className="mt-3">
          <Button type="submit">Sweep</Button>
        </form>
      </section>
    );
  }

  const total = sweep.notesTotal;
  const reachedLine =
    total === null
      ? `${sweep.reached} ${sweep.reached === 1 ? 'note' : 'notes'} reached`
      : `${sweep.reached} of ${total} notes reached`;

  const heading =
    sweep.status === 'done'
      ? `Swept ${sweep.reached} notes, finished ${dateFormat.format(new Date(sweep.finishedAt ?? sweep.startedAt))}`
      : sweep.status === 'stopped'
        ? `Sweep stopped: ${reachedLine}`
        : `Sweeping: ${reachedLine}`;

  const lines = OUTCOME_LINES.filter(({ outcome }) => (sweep.outcomes[outcome] ?? 0) > 0);

  return (
    <section className={cn(cardVariants(), 'mb-4 p-4')} aria-labelledby="sweep-heading">
      <h2 id="sweep-heading" className="text-body font-semibold text-ink">
        {heading}
      </h2>
      {sweep.status === 'running' && (
        <p className="mt-1 text-ui text-ink-muted">
          It works for a few minutes every five minutes until every note is reached. Reload to see
          how far it has got.
        </p>
      )}
      {sweep.lastError && (
        <p className="mt-2 rounded-lg bg-caution-tint px-3 py-2 text-ui text-ink">
          The last run could not continue: {sweep.lastError}
        </p>
      )}

      {lines.length > 0 && (
        <ul className="mt-3 space-y-1 text-ui text-ink">
          {lines.map(({ outcome, label }) => (
            <li key={outcome}>
              <span className="tabular-nums font-medium">{sweep.outcomes[outcome]}</span> {label}
            </li>
          ))}
        </ul>
      )}

      {(sweep.positions > 0 || sweep.cutShort > 0 || sweep.sectionsFailed > 0) && (
        <ul className="mt-2 space-y-1 text-ui text-ink-muted">
          {sweep.positions > 0 && (
            <li>
              {sweep.positions} positions written, {sweep.newPositions} of them new to the map.
            </li>
          )}
          {sweep.cutShort > 0 && (
            <li>
              {sweep.cutShort} {sweep.cutShort === 1 ? 'note was' : 'notes were'} longer than
              400,000 characters and read only up to that point.
            </li>
          )}
          {sweep.sectionsFailed > 0 && (
            <li>
              {sweep.sectionsFailed} {sweep.sectionsFailed === 1 ? 'note' : 'notes'} had sections
              that failed to read. The rest of each was written, and the next sweep reads them
              again.
            </li>
          )}
        </ul>
      )}

      {sweep.failures.length > 0 && (
        <div className="mt-3">
          <h3 className="text-ui font-medium text-ink">Failed</h3>
          <ul className="mt-1 space-y-1 text-ui text-ink-muted">
            {sweep.failures.map((failure, i) => (
              <li key={i}>
                <span className="text-ink">{failure.title}</span>: {failure.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={sweep.status === 'running' ? stopSweep : startSweep} className="mt-3">
        {sweep.status === 'running' ? (
          <Button type="submit" variant="secondary">
            Stop
          </Button>
        ) : sweep.status === 'stopped' ? (
          <Button type="submit">Sweep</Button>
        ) : (
          <>
            <Button type="submit" variant="secondary">
              Sweep
            </Button>
            <p className="mt-2 text-small text-ink-muted">
              A new sweep sends only the notes that are new, changed or failed since this one.
            </p>
          </>
        )}
      </form>
    </section>
  );
}
