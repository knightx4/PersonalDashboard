'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { acknowledgeGoalRunAction } from './actions';

/**
 * A goal run that went silent (plan #1825), as a panel of labelled facts with
 * Acknowledge to end it. A silent run is no longer closed by a timer, so it
 * waits here for you to say you have seen it.
 */
export function AcknowledgeRun({
  runId,
  lastHeard,
  lastOn,
  started,
}: {
  runId: string;
  /** "56 minutes ago". */
  lastHeard: string;
  /** What it said it was on when last heard from, or null. */
  lastOn: string | null;
  /** When it started, as the page writes times. */
  started: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const facts: Array<[string, string]> = [
    ['State', 'Went silent'],
    ['Last heard', lastHeard],
    ...(lastOn ? ([['Working on', lastOn]] as Array<[string, string]>) : []),
    ['Started', started],
  ];

  return (
    <section className="space-y-3 rounded-card bg-caution-tint card-pad" aria-label="This run went silent">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className={label === 'State' ? 'font-medium text-caution' : 'min-w-0 break-words text-ink'}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          pending={pending}
          onClick={() =>
            start(async () => {
              const result = await acknowledgeGoalRunAction(runId);
              setError(result.error ?? null);
            })
          }
        >
          {pending ? 'Ending…' : 'Acknowledge'}
        </Button>
        <p className="text-small text-ink-muted">Ends the run, recorded as stopped.</p>
      </div>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
