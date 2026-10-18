import type { InsightRun } from '@/lib/you/insights';

/**
 * What the Look again button on the Insights tab needs to start and show a
 * run (plan #2413.5).
 */

/**
 * A run still queued or running this long after it was asked for has
 * stopped: the tab shows it failed, and the next press marks it failed before
 * checking for one in progress. The same three hours as company research
 * (lib/jobs/companies/research.ts).
 */
export const INSIGHT_RUN_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/** What the stale check writes into a run that stopped without saying so. */
export const STALE_RUN_ERROR = 'The run stopped without finishing. Try again.';

/** What the tab shows about the newest run. */
export type InsightRunState =
  | { kind: 'none' }
  | { kind: 'running'; run: InsightRun }
  | { kind: 'failed'; run: InsightRun; error: string }
  | { kind: 'ready'; run: InsightRun };

/** The newest run as the tab draws it; one queued or running past the stale mark reads as failed. */
export function insightRunState(run: InsightRun | null, now: number = Date.now()): InsightRunState {
  if (!run) return { kind: 'none' };
  if (run.status === 'queued' || run.status === 'running') {
    const asked = new Date(run.requestedAt).getTime();
    if (Number.isFinite(asked) && now - asked > INSIGHT_RUN_STALE_AFTER_MS) {
      return { kind: 'failed', run, error: STALE_RUN_ERROR };
    }
    return { kind: 'running', run };
  }
  if (run.status === 'failed') {
    return { kind: 'failed', run, error: run.error ?? 'The last run did not finish.' };
  }
  return { kind: 'ready', run };
}
