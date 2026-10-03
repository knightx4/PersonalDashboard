'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { useChangedWhileWatched, useCountUp, useReducedMotion } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import { MOTION_MS } from '@/lib/motion';

/** What the card says, worked out on the server (lib/news/quick/got-through.ts). */
export type GotThroughSummary = {
  read: number;
  skipped: number;
  /** The story you stayed on longest, and for how long: "3 minutes". */
  longest: { headline: string; held: string } | null;
  /** The newsletters due next, soonest first, with when: "tomorrow around 7:00 AM". */
  due: readonly { from: string; when: string }[];
};

/**
 * The end of Quick read (plan #1557, docs/UI-QUALITY-SPEC.md Part 8): under
 * the caught-up mark, a card saying how many stories you read and skipped
 * today, the one you stayed on longest, and which newsletters are due next.
 *
 * It stays mounted while there are stories left and draws nothing then, so it
 * can tell the last story passed while you watch, which counts the figures up
 * from nothing and lifts the card in as the day's sigil draws above it, from
 * a page that loads already caught up, which shows the card at once. Under
 * reduced motion it is the same card, with no count-up and no lift.
 */
export function GotThrough({
  done,
  summary,
  className,
}: {
  /** True when there is no story left to show. */
  done: boolean;
  summary: GotThroughSummary | null;
  className?: string;
}) {
  const changed = useChangedWhileWatched(done);
  const reduceMotion = useReducedMotion();
  const [played, setPlayed] = useState(false);
  // A new story arriving reopens the deck, so reaching the end again plays again.
  if (!done && played) setPlayed(false);
  const playing = done && changed && !reduceMotion && !played;

  const read = useCountUp(done ? (summary?.read ?? 0) : 0, { durationMs: MOTION_MS.moment });
  const skipped = useCountUp(done ? (summary?.skipped ?? 0) : 0, {
    durationMs: MOTION_MS.moment,
  });

  if (!done || !summary || summary.read + summary.skipped === 0) return null;

  return (
    <div
      className={cn(playing && 'got-through-in', className)}
      // The card's lift is the last thing to land. An event rather than a
      // timer, so a recording slowed to a quarter speed sees all of it.
      onAnimationEnd={(event) => {
        if (event.animationName === 'got-through-rise') setPlayed(true);
      }}
    >
      <Card padding="standard" data-got-through="">
        <h2 className="text-ui font-semibold text-ink">Today in Quick read</h2>
        <dl className="mt-2 flex gap-8">
          <div>
            <dt className="text-small text-ink-muted">Read</dt>
            <dd className="tabular font-display text-title text-ink">{read}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-muted">Skipped</dt>
            <dd className="tabular font-display text-title text-ink">{skipped}</dd>
          </div>
        </dl>
        {/* The figures count up for the eye; this says them once, as they end. */}
        <p className="sr-only" role="status">
          {`You read ${summary.read} and skipped ${summary.skipped} today.`}
        </p>
        {summary.longest && (
          <p className="mt-3 break-words text-ui text-ink">
            You stayed longest on <span className="font-medium">{summary.longest.headline}</span>,
            for about {summary.longest.held}.
          </p>
        )}
        {summary.due.length > 0 && (
          <p className="mt-2 text-ui text-ink-muted">
            Next due:{' '}
            {summary.due.map(({ from, when }, index) => (
              <span key={from}>
                {index > 0 && (index === summary.due.length - 1 ? ' and ' : ', ')}
                {from} {when}
              </span>
            ))}
            .
          </p>
        )}
      </Card>
    </div>
  );
}
