'use client';

import { useEffect, useRef, useState } from 'react';
import { ReadingCard } from '@/components/learn/reading-card';
import { cardVariants } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { rowRef } from '@/lib/core/move';
import type { ReadingRow } from '@/lib/learn/tracks/load';
import { cn } from '@/lib/cn';

/** How long the press waits on the server before its run is handed over. */
const HAND_OVER_MS = 250;

/**
 * "Dash is on it" arriving on a row (plan #1964.2.2), played on demand for
 * `npm run record`. The press starts a run about one reading: the button
 * holds Dash's working mark beside its words, and the reading's "No source
 * yet" gives way to the working mark and "Dash is on it" the moment the run
 * is handed over. Nothing is written anywhere.
 */
export function DashWorkingReadingDemo({
  readings,
  target,
}: {
  readings: readonly ReadingRow[];
  /** The reading the run is about. */
  target: string;
}) {
  const [phase, setPhase] = useState<'ready' | 'pending' | 'going'>('ready');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const working = phase === 'going' ? [rowRef('learn.readings', target) as string] : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-[1_1_14rem] text-small text-ink-muted" role="status">
          {phase === 'going' ? 'Dash is finding a source for one reading.' : 'One reading has no source yet.'}
        </p>
        <DashAction
          type="button"
          size="sm"
          variant="secondary"
          data-motion-demo="dash-row"
          // The working mark beside the words for as long as the run goes; the
          // row below is what this sheet is about.
          pending={phase !== 'ready'}
          onClick={() => {
            clearTimeout(timer.current);
            setPhase('pending');
            timer.current = setTimeout(() => setPhase('going'), HAND_OVER_MS);
          }}
        >
          {phase === 'going' ? 'Finding a source' : 'Find a source'}
        </DashAction>
      </div>
      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {readings.map((reading) => (
          <ReadingCard key={reading.id} reading={reading} working={working} />
        ))}
      </ul>
    </div>
  );
}
