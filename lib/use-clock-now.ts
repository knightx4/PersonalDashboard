import { useSyncExternalStore } from 'react';

/**
 * The wall clock, as something to subscribe to.
 *
 * One interval for everything reading a clock rather than one per row: a plan
 * with six steps underway and a thread with nine comments on it should not be
 * fifteen timers waking the tab up out of step with each other. It only runs
 * while something is watching, and 30 seconds is as often as a figure rounded
 * to the minute can change.
 *
 * Zero until the first subscriber arrives, which is what makes it safe to
 * render on the server: an elapsed time is the one value already different by
 * the time the HTML lands, so both sides render from zero and the figure
 * appears on the tick after mount.
 *
 * It lives here rather than in the plan page because the comment thread needs
 * the same clock and a second implementation of it would be a second interval.
 */
const CLOCK_TICK_MS = 30_000;
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockWatchers = new Set<() => void>();

function subscribeToClock(onTick: () => void): () => void {
  clockWatchers.add(onTick);
  if (clockTimer === null) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const watcher of clockWatchers) watcher();
    }, CLOCK_TICK_MS);
  }
  return () => {
    clockWatchers.delete(onTick);
    if (clockWatchers.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** The wall clock as a number. Zero until the first tick after mount. */
export function useClockNow(): number {
  return useSyncExternalStore(
    subscribeToClock,
    () => clockNow,
    () => 0,
  );
}
