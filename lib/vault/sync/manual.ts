import { RUN_BUDGET_MS } from '@/lib/vault/sync/run';
import type { SyncRunSummary } from '@/lib/vault/sync/progress';

/**
 * Whether a hand-pressed sync may start.
 *
 * Two runs over one vault at once is not catastrophic -- writes are upserts by
 * path and the cursor only advances on a complete pass -- but it is wasted
 * request budget against a fine-grained PAT's 5,000-an-hour ceiling, and it
 * makes the progress bar lurch. So a run already in flight wins, and the
 * button says so rather than pretending it did something.
 *
 * The catch is that "in flight" is a row somebody has to finish writing. A run
 * whose host was reclaimed mid-flight leaves `running` behind forever, and a
 * button that is dead until the next nightly pass is worse than one that
 * occasionally overlaps. So a row older than one run's whole budget, with
 * slack, is treated as abandoned.
 */
export const STALE_RUN_MS = RUN_BUDGET_MS + 60_000;

export function activeRun(
  runs: readonly SyncRunSummary[],
  now: number = Date.now(),
): SyncRunSummary | null {
  for (const run of runs) {
    if (run.status !== 'running' && run.status !== 'queued') continue;
    const startedAt = run.startedAt ? Date.parse(run.startedAt) : NaN;
    // No start time at all is a row we cannot age out; treat it as live rather
    // than trample a run that may well be working.
    if (Number.isNaN(startedAt)) return run;
    if (now - startedAt < STALE_RUN_MS) return run;
  }
  return null;
}
