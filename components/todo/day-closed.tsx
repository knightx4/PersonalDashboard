'use client';

import { useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useChangedWhileWatched, useReducedMotion } from '@/components/ui/motion';
import { Card } from '@/components/ui/card';
import { Sigil } from '@/components/ui/sigil';
import { dayClosedLine, type DoneTodayTask } from '@/lib/todo/agenda/day-close';

/** How many cards the folded pile shows; the line names the full count. */
const PILE_CARDS = 3;

/**
 * The day closing on the agenda (plan #1556, docs/UI-QUALITY-SPEC.md Part 8).
 *
 * Once nothing is left under Overdue and Today and something due by today was
 * finished, the done tasks sit in a "Done today" pile folded shut, the day's
 * sigil is beside it, and a line says how many were finished. The tick that
 * closes the day has already had its buzz (completionMoment in the row).
 *
 * It stays mounted while the day is open and draws nothing then, so it can
 * tell a close made while you watch, which plays the fold, the sigil drawing
 * in and the line, from a page that loads already closed, which shows the
 * folded pile at once. Under reduced motion it is always the folded pile.
 * Key it by the day, so midnight is a new day rather than a reopened one.
 */
export function DayClosed({
  closed,
  done,
  seed,
  nothingElse = false,
  className,
}: {
  closed: boolean;
  /** The tasks finished today that were due by today, most recent first. */
  done: readonly DoneTodayTask[];
  /** What the sigil is drawn from: the account and the day. */
  seed: string;
  /** Nothing else is on the list either, so the line says so. */
  nothingElse?: boolean;
  className?: string;
}) {
  const changed = useChangedWhileWatched(closed);
  const reduceMotion = useReducedMotion();
  const [played, setPlayed] = useState(false);
  // Undoing the last tick reopens the day, so closing it again plays again.
  if (!closed && played) setPlayed(false);
  const playing = closed && changed && !reduceMotion && !played;

  if (!closed || done.length === 0) return null;

  const cards = done.slice(0, PILE_CARDS);

  return (
    <section
      aria-labelledby="day-closed-heading"
      className={cn('flex items-center gap-4', playing && 'day-close-in', className)}
      // The sigil's last cell is the last thing to land, so its end is the
      // moment's end. An event rather than a timer, so a recording slowed to
      // a quarter speed still sees the whole of it.
      onAnimationEnd={(event) => {
        if (event.animationName !== 'sigil-cell') return;
        const cells = event.currentTarget.querySelectorAll('[data-sigil-cell]');
        if (event.target === cells[cells.length - 1]) setPlayed(true);
      }}
    >
      <Sigil seed={seed} size={56} className="text-accent" />
      <div className="min-w-0 flex-1">
        <h2 id="day-closed-heading" className="text-ui font-semibold text-ink">
          Done today
          <span className="tabular ml-2 text-small font-normal text-ink-muted">{done.length}</span>
        </h2>
        {/* The pile, folded: the last one ticked on top, the rest edging out
            beneath it. While it plays, each card starts where it sat as a
            row and springs into the stack. */}
        <div className="relative mt-1.5 pb-2.5" aria-hidden>
          {cards
            .map((task, index) => (
              <Card
                key={task.id}
                padding="none"
                data-pile-card=""
                style={
                  {
                    '--pile-i': String(index),
                    transform: `translateY(${index * 6}px) scale(${1 - index * 0.05})`,
                  } as CSSProperties
                }
                className={cn(
                  'flex origin-top items-center gap-2 px-3 py-2 text-small text-ink-muted',
                  // The top card holds the pile's room; the rest sit under it.
                  index === 0 ? 'relative' : 'absolute inset-x-0 top-0',
                )}
              >
                <Check className="size-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden />
                <span className="truncate line-through decoration-ink-ghost">{task.title}</span>
              </Card>
            ))
            // Reversed so the top card paints last and sits over the rest.
            .reverse()}
        </div>
        <p data-day-close-line="" className="mt-3 text-small text-ink-muted" role="status">
          {dayClosedLine(done.length)}
          {nothingElse && ' Nothing else is on the list.'}
        </p>
      </div>
    </section>
  );
}
