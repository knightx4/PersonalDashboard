/**
 * Reporting back on a question handed to a goal (plan #2778.8).
 *
 * Every five minutes, beside the done-step message, the job reads the question
 * runs (goals.runs.question) that ended and are not reported. For each it
 * sends one notification, 'Done: <question>', opening the goal's Dashboard at
 * that work, and for a question from Ask Dash writes a reply line into the
 * conversation with the same link. A Claude chat cannot be written back to
 * through the connector, so for those the notification is the reply.
 *
 * `reported_at` is the send-once guard: the pass sets it before sending, so
 * two passes that overlap cannot both report. A send that reached no device
 * and failed on at least one clears it again, unless the reply line was
 * already written (the reply is the record that it was reported).
 *
 * Only runs ended in the last day are reported: an older end is one the job
 * missed while it was down, and a message that late reads as news it is not.
 *
 * Kept free of Supabase so it can be tested with fakes; the adapters are in
 * inngest/goals/take-on-report.ts.
 */

import { sendToPerson, type PushPorts, type PushResult } from '@/lib/push/send';
import { takeOnPayload, takeOnReply, type EndedQuestion } from './take-on';

/** An end older than this is not reported. */
export const REPORT_WINDOW_HOURS = 24;

export type TakeOnReportPorts = {
  /** Question runs ended at or after `since` and not reported, across everyone; each names its person. */
  due(since: Date): Promise<EndedQuestion[]>;
  /** Sets `reported_at` if it is still empty, scoped to the run's person. True when this call set it. */
  claim(run: EndedQuestion, at: Date): Promise<boolean>;
  /** Clears `reported_at` after a report that reached nothing. */
  release(run: EndedQuestion): Promise<void>;
  /** Writes Dash's reply line into the Ask Dash conversation the question came from. */
  reply(run: EndedQuestion, line: ReturnType<typeof takeOnReply>): Promise<void>;
  /** Where the person's notifications go; null when nothing can be signed. */
  push(userId: string): PushPorts | null;
};

export type TakeOnOutcome =
  | { runId: string; kind: 'reported'; replied: boolean; push: PushResult | null }
  | { runId: string; kind: 'retry'; push: PushResult }
  | { runId: string; kind: 'taken' };

export type TakeOnSummary = { runs: number; outcomes: TakeOnOutcome[]; failed: string[] };

export async function runTakeOnReports(ports: TakeOnReportPorts, now: Date): Promise<TakeOnSummary> {
  const since = new Date(now.getTime() - REPORT_WINDOW_HOURS * 3_600_000);
  const runs = await ports.due(since);
  const summary: TakeOnSummary = { runs: runs.length, outcomes: [], failed: [] };

  for (const run of runs) {
    try {
      if (!(await ports.claim(run, now))) {
        summary.outcomes.push({ runId: run.runId, kind: 'taken' });
        continue;
      }
      let replied = false;
      try {
        if (run.origin === 'ask_dash' && run.originRef) {
          await ports.reply(run, takeOnReply(run));
          replied = true;
        }
        // Without the signing keys there is no notification; the reply, or
        // the Dashboard, is the report.
        const push = ports.push(run.userId);
        const result = push ? await sendToPerson(push, run.userId, takeOnPayload(run), now) : null;
        if (result && result.sent === 0 && result.failed > 0 && !replied) {
          await ports.release(run);
          summary.outcomes.push({ runId: run.runId, kind: 'retry', push: result });
          continue;
        }
        summary.outcomes.push({ runId: run.runId, kind: 'reported', replied, push: result });
      } catch (err) {
        if (!replied) await ports.release(run);
        throw err;
      }
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
