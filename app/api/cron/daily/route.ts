import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron, requestOrigin } from '@/inngest/cron/authorize';
import { runInboxIncrementalSync } from '@/inngest/cron/inbox';
import { runJobSweep } from '@/inngest/jobs/cron/sweep';
import { runJdBackfill } from '@/inngest/jobs/cron/jd-backfill';
import { kickCompanyBoards } from '@/inngest/jobs/company-boards';
import { runRecurringReread } from '@/inngest/cron/recurring-reread';
import { runMonthReviews } from '@/inngest/finances/month-review';
import { runPlaidSyncForAll } from '@/inngest/finances/plaid-sync';
import { runVaultSyncForAll } from '@/inngest/vault/sync';
import { runClaimSweep } from '@/inngest/dev/claims';
import { runDevDigest } from '@/inngest/dev/digest';
import { runIdeaScoreCatchUp } from '@/inngest/dev/idea-scores';
import { runGoalsDaily } from '@/inngest/goals/daily';
import { runGoalsQuietSweep } from '@/inngest/goals/quiet-runs';
import { runGoalsRhythms } from '@/inngest/goals/rhythms';
import { runGoalsWeekly } from '@/inngest/goals/weekly';
import { runScopeDays } from '@/inngest/goals/scope-days';
import { runBriefWatch } from '@/inngest/learn/brief-watch';
import { runLearnEmbeddingsDaily } from '@/inngest/learn/embeddings-daily';
import { runLitTopicPullsDaily } from '@/inngest/learn/lit-topic-pulls';
import { runPreparationsDaily } from '@/inngest/learn/prepare';
import { runFigureNeedStepsDaily } from '@/inngest/learn/figure-need-steps';
import { runFigureBackfillDaily } from '@/inngest/learn/figure-backfill';
import { runXReadsForAll } from '@/inngest/x/read';
import { runInsightSignals } from '@/inngest/you/insight-signals';
import { runInsightsTick } from '@/inngest/you/insights-tick';

// Long enough for the pump it starts: PUMP_BUDGET_MS is what that work is
// allowed to take, and a route that ends first takes the hand-off with it.
export const maxDuration = 300;

/**
 * Everything scheduled, behind one cron.
 *
 * One inbox sync, shared by both workspaces, then the job sweep, then the JD
 * backfill, then the vault, then the dev digest. The first two are ordered on
 * purpose -- a message that arrived this morning has to be ingested before
 * anything is judged to have gone quiet.
 *
 * The next two are ordered by what their absence costs. The backfill talks to
 * somebody else's server, and a job description that arrives tomorrow instead
 * of today is still a description; a sweep that never runs is a pipeline that
 * quietly stops telling the truth. The vault comes after both: it is the
 * newest stage, and nothing reads it yet, so its freshness buys nothing today
 * and it must never be what delays a stage that does matter.
 *
 * The morning goals run (plan #933) only fires the goals routine and returns,
 * so it costs a few reads and one request. It comes before the dev stages
 * because its results are what the person opens the app for. The weekly
 * goals run (plan #934) follows it: every day it marks last week's unanswered
 * suggestions ignored, and once a week, kept by the gap since the last weekly
 * run, it fires the same routine to research city events. There is no second
 * cron for it because the Hobby plan allows one. The quiet-run sweep
 * (plan #1002) goes first of the three, so a run that died yesterday is
 * closed before the morning run reads what is still going. The rhythm sync
 * comes next: it closes yesterday's ended periods and writes the counts a
 * rhythm reads from Jobs or the calendar, after the inbox has filed the
 * night's applications, so the morning run reads this morning's counts.
 *
 * The claim sweep and the digest are both about the dev pages, and they are in
 * that order because the sweep corrects rows the digest then reports: a step
 * whose session died is put back before the summary lists what is underway.
 *
 * The digest is last but one because it summarises the day, and a note fixed
 * overnight should be on the morning summary of the day it was fixed  rather
 * than of the day after. The idea-score catch-up follows it only because the
 * digest files ideas.
 *
 * Each stage is isolated. A failure in one is reported and the rest still run,
 * because the alternative is that a broken job inbox silently stops the
 * commerce sync that has been working for months.
 */
type Stage = { name: string; run: () => Promise<unknown> };

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = requestOrigin(request);
  const stages: Stage[] = [
    { name: 'inbox', run: () => runInboxIncrementalSync(origin) },
    // After the inbox, so a receipt the sync just filed under a store is
    // re-read the same morning (plan #1212).
    { name: 'recurring-reread', run: () => runRecurringReread() },
    { name: 'jobs-sweep', run: () => runJobSweep() },
    { name: 'jd-backfill', run: () => runJdBackfill() },
    // Kicks the look for the boards of companies on file, which runs in a
    // function of its own so a slow careers page delays nothing here
    // (plan #2535.2).
    { name: 'company-boards', run: () => kickCompanyBoards(origin) },
    { name: 'vault', run: () => runVaultSyncForAll() },
    // Balances, transactions, card and loan details and holdings for every
    // linked Plaid Item (plan #2593.4). A few seconds a link; nothing until
    // Plaid's keys are set.
    { name: 'finances-plaid', run: () => runPlaidSyncForAll() },
    // After the sync, so the month's last transactions are in: the review of
    // the month before, written once on the first day this runs in a month
    // (plan #2593.8.2). One Sonnet call a person a month; a read of the
    // stored row every other day, and nothing for anyone without accounts.
    { name: 'finances-review', run: () => runMonthReviews() },
    { name: 'goals-quiet-runs', run: () => runGoalsQuietSweep() },
    { name: 'goals-rhythms', run: () => runGoalsRhythms() },
    { name: 'goals-daily', run: () => runGoalsDaily() },
    { name: 'goals-weekly', run: () => runGoalsWeekly() },
    // The numbers insights start from are counted here in SQL with no model
    // call, after the goals stages have closed the morning's steps (plan
    // #2413.7). The insights stage after it fires the goals routine with the
    // insights skill only when the last ready run is over 30 days old.
    { name: 'insight-signals', run: () => runInsightSignals() },
    { name: 'insights-monthly', run: () => runInsightsTick() },
    // After the goals stages: the counts are of the steps as they stand once
    // the morning's closing is done (plan #1836).
    { name: 'scope-days', run: () => runScopeDays() },
    { name: 'plan-claims', run: () => runClaimSweep() },
    { name: 'dev-digest', run: () => runDevDigest() },
    // After the digest, which files ideas overnight without triage, so they
    // and any other idea still unscored get Jev's score the same morning
    // (plan #1327).
    { name: 'idea-scores', run: () => runIdeaScoreCatchUp() },
    // The person's own X posts, newest since the last read (plan #1819).
    // Before the embeddings so a slow model call cannot crowd it out.
    { name: 'x-posts', run: () => runXReadsForAll() },
    // Research briefs with the watch switch on, checked for new sources once
    // a week, or monthly once they go quiet (plan #2023.8). At most three a
    // day, inside two minutes with their cards.
    { name: 'learn-brief-watch', run: () => runBriefWatch() },
    // Last, and bounded: Learn ideas saved without a vector get one (plan #1854),
    // then the places on Idea Space are worked out from them again (plan #1997.2).
    { name: 'learn-embeddings', run: () => runLearnEmbeddingsDaily() },
    // After the embeddings, which light the topics: one structure document for
    // each of up to five topics that just lit (plan #2247.11).
    { name: 'learn-lit-topic-pulls', run: () => runLitTopicPullsDaily() },
    // Subjects whose preparation stopped short (plan #2276.1). Each is started
    // in a function of its own, so this stage costs a few requests.
    { name: 'learn-preparations', run: () => runPreparationsDaily(origin) },
    // Figures two lessons asked for, or one in a subject with a goal, become
    // a plan step for the overnight run (plan #2321.10). A few reads.
    { name: 'learn-figure-need-steps', run: () => runFigureNeedStepsDaily() },
    // Lessons that asked for a figure whose step is now built get it in place
    // of the wanted block (plan #2321.11). At most ten blocks, one call each.
    { name: 'learn-figure-backfill', run: () => runFigureBackfillDaily() },
  ];

  const results: Record<string, unknown> = {};
  const failed: string[] = [];

  for (const stage of stages) {
    try {
      results[stage.name] = await stage.run();
    } catch (err) {
      failed.push(stage.name);
      results[stage.name] = { error: err instanceof Error ? err.message : 'failed' };
    }
  }

  // 207: some stages may have failed while others did real work, and a plain
  // 500 would tell a log reader nothing about which.
  return NextResponse.json({ ok: failed.length === 0, failed, results }, {
    status: failed.length === 0 ? 200 : 207,
  });
}
