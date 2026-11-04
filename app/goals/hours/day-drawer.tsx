'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { LogDone } from '@/components/goals/log-done';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { scrim } from '@/components/ui/popover';
import { formatWeekday } from '@/lib/goals/dates';
import { hoursText, type HoursEntry } from '@/lib/goals/hours';

const noSubscribe = () => () => {};

/** Where the day's read has got to. */
export type DayState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: HoursEntry[] };

/**
 * One day's logged hours (plan #2907.2), opened by tapping a day in the Day
 * by day grid. It rises from the bottom on a phone and slides in from the
 * right on a laptop, so the grid stays in view beside it, as the Quick read's
 * Discuss sheet does. Each entry shows its goal, its hours and what was
 * written; a day with none says so and offers Log hours with the date chip
 * already on that day.
 */
export function DayDrawer({
  day,
  today,
  earliest,
  state,
  onRetry,
  onClose,
  logOpen = false,
  contained = false,
}: {
  day: string;
  today: string;
  earliest: string;
  state: DayState;
  onRetry: () => void;
  onClose: () => void;
  /** Draw the empty day's Log hours open, for the gallery. */
  logOpen?: boolean;
  /**
   * Drawn inside the nearest positioned box instead of over the window, for
   * the gallery, whose full-page shots would otherwise cut a window-fixed
   * sheet off partway down the page.
   */
  contained?: boolean;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    if (!contained) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!contained) document.body.style.overflow = '';
    };
  }, [onClose, contained]);

  // The sheet is drawn on document.body, which the server render has not got.
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;

  const total =
    state.status === 'ready' ? state.entries.reduce((sum, entry) => sum + entry.hours, 0) : 0;
  const titleId = `hours-day-${day}`;
  const sheet = (
    <div className={contained ? 'absolute inset-0 z-overlay' : 'fixed inset-0 z-overlay'}>
      <button type="button" aria-label="Close the day" onClick={onClose} className={scrim} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-card border-t border-border bg-surface md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[min(26rem,100vw)] md:rounded-none md:border-l md:border-t-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-ui font-semibold text-ink">
              {formatWeekday(day)}
              {day === today && <span className="font-normal text-ink-muted">, today</span>}
            </h2>
            {state.status === 'ready' && state.entries.length > 0 && (
              <p className="tabular mt-0.5 text-small text-ink-muted">
                {hoursText(total)} logged
              </p>
            )}
          </div>
          <IconButton label="Close the day" onClick={onClose}>
            <X strokeWidth={1.75} aria-hidden />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {state.status === 'loading' ? (
            <p className="text-ui text-ink-muted" aria-live="polite">
              Reading the day’s hours…
            </p>
          ) : state.status === 'error' ? (
            <div className="space-y-2">
              <p className="text-ui text-danger" role="alert">
                {state.message}
              </p>
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          ) : state.entries.length === 0 ? (
            <div className="space-y-3">
              <p className="text-ui text-ink-muted">Nothing logged this day.</p>
              <LogDone
                label="Log hours for this day"
                placeholder="e.g. applied 2h, cleaned 1.5h"
                days={{ today, earliest, initial: day }}
                initialOpen={logOpen}
                narrow
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {state.entries.map((entry) => (
                <li key={entry.id} className="space-y-0.5 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-ui font-medium text-ink">{entry.goalTitle}</p>
                    <p className="tabular shrink-0 text-ui font-semibold text-ink">
                      {hoursText(entry.hours)}
                    </p>
                  </div>
                  <p className="break-words text-small text-ink-muted">
                    {entry.stepTitle && <span>{entry.stepTitle}: </span>}
                    {entry.note}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
  return contained ? sheet : createPortal(sheet, document.body);
}
