import type { InsightRun } from '@/lib/you/insights';

/**
 * What the Look again button on the Insights tab needs to start and show a
 * run (plan #2413.5), kept apart from lib/you/insights.ts so the step that
 * writes the method (#2413.4) can replace the brief without touching the tab.
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

/**
 * PLACEHOLDER BRIEF (plan #2413.5). The goals routine is fired with this
 * until #2413.4 writes `insightsBrief` in lib/you/insights.ts; that step
 * replaces the body of this function with a call to it, or the import in
 * app/you/insights/actions.ts with `insightsBrief`, and deletes this one.
 * Its first two lines are the ones the insights skill is fired with; the
 * rest is the least a session needs to fill the run and close it while that
 * skill is not on the branch yet.
 */
export function insightRunBrief(input: { runId: string; userId: string }): string {
  return [
    'Follow .claude/skills/insights/SKILL.md',
    `Insight run ${input.runId}`,
    `user_id ${input.userId}`,
    'PLACEHOLDER BRIEF from plan #2413.5, until #2413.4 writes insightsBrief. If that skill is not there yet:',
    'Set the you.insight_runs row above to running with started_at now.',
    "Read the person's notes, You rows and history, and write each insight into you.insights with this run_id:",
    'a claim, layers [{depth saw|deeper|further, text}] going at least two layers below what they wrote,',
    'receipts [{source,row_id,quote,link}] for every claim, and a confidence of high, medium or hunch.',
    'Read you.insight_verdicts first and never write an insight they have already marked again.',
    'Write rows through scripts/sql.ts, scoped to the user_id above.',
    'Finish by setting the run ready with a one-paragraph summary and finished_at, or failed with the error.',
  ].join('\n');
}
