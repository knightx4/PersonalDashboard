/**
 * Does Learn know what you know (plan #2179.2)?
 *
 *   npx tsx scripts/learn-measure.ts [--user <id>]
 *
 * Prints five numbers, each with the count behind it and what it cannot tell
 * at that count:
 *
 *   1. next-answer prediction: AUC and log loss of the predicted strength over
 *      the latest answers, held out by date, against guessing the earlier
 *      share right;
 *   2. calibration: the share right within each band of predicted strength;
 *   3. grader agreement: Cohen's kappa over cells two graders both judged;
 *   4. sessions per week, in Learn and across the app, from core.page_views;
 *   5. completion of the rows Learn picked against the readings you queued,
 *      from learn.next_outcomes.
 *
 * The answers are the harness export of scripts/learn-ordering-report.ts, read
 * through the same loader (lib/learn/harness-export.ts). Needs DATABASE_URL
 * (service role), or SUPABASE_SERVICE_ROLE_KEY for the HTTPS route a cloud
 * session uses. Nothing is written back. The arithmetic is lib/learn/measure.ts.
 */
import postgres from 'postgres';
import { httpsSql, restTransport } from '../lib/db/https-sql';
import { loadHarnessExport } from '../lib/learn/harness-export';
import {
  BAND_EDGES,
  HELD_OUT_SHARE,
  agreement,
  calibration,
  cannotTell,
  completion,
  prediction,
  scoredAnswers,
  sessionsPerWeek,
  type Completion,
  type PageView,
  type Sessions,
} from '../lib/learn/measure';
import type { OutcomeRow } from '../lib/learn/ordering-report';

const argv = process.argv.slice(2);
function arg(flag: string): string | null {
  const at = argv.indexOf(flag);
  return at > -1 ? (argv[at + 1] ?? null) : null;
}

function connect() {
  const url = process.env.DATABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key && (process.env.CLAUDE_CODE_REMOTE === 'true' || !url)) {
    const rest = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://asjztutnqxbecruvyrbj.supabase.co';
    return httpsSql(restTransport(rest, key)) as unknown as ReturnType<typeof postgres>;
  }
  if (!url) {
    console.error('Neither DATABASE_URL nor SUPABASE_SERVICE_ROLE_KEY is set. One is needed to read Learn.');
    process.exit(1);
  }
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} });
}

type Rows = Record<string, unknown>[];

const fixed = (value: number | null, places = 3) => (value === null ? 'cannot be worked out' : value.toFixed(places));
const pct = (part: number, whole: number) => (whole === 0 ? '-' : `${Math.round((part / whole) * 100)}%`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '-');

function printCannot(lines: string[]) {
  for (const line of lines) console.log(`   cannot tell: ${line}`);
}

function printSessions(label: string, s: Sessions) {
  console.log(
    `   ${label}: ${s.sessions} sessions from ${s.views} page views over ${s.weeks.toFixed(1)} weeks, ` +
      `${fixed(s.perWeek, 1)} a week`,
  );
  if (s.byWeek.length > 0) {
    console.log(`     by week from Monday: ${s.byWeek.map((w) => `${w.monday.slice(5)} ${w.sessions}`).join(', ')}`);
  }
}

function printCompletion(c: Completion) {
  console.log(`   ${c.label.padEnd(34)} ${c.done} of ${c.total} done (${pct(c.done, c.total)}), not now ${c.notNow}`);
}

async function main() {
  const sql = connect();
  const user = arg('--user');
  const now = new Date();

  const harness = await loadHarnessExport(sql, user);
  const viewRows = (await sql`
    select user_id, workspace, viewed_at
    from core.page_views
    where (${user}::uuid is null or user_id = ${user}::uuid)
    order by viewed_at`) as unknown as Rows;
  const outcomeRows = (await sql`
    select user_id, kind::text as kind, outcome::text as outcome, happened_at
    from learn.next_outcomes
    where (${user}::uuid is null or user_id = ${user}::uuid)
    order by happened_at`) as unknown as Rows;

  const scored = scoredAnswers(harness.rows);
  const predicted = prediction(scored);
  const bands = calibration(scored);
  const agreed = agreement(harness.rows);
  const views = viewRows.map((r) => ({
    userId: String(r.user_id),
    workspace: r.workspace ? String(r.workspace) : null,
    at: new Date(r.viewed_at as string),
  }));
  const learnSessions = sessionsPerWeek(
    views.filter((v) => v.workspace === 'learn').map((v): PageView => ({ userId: v.userId, at: v.at })),
    now,
  );
  const appSessions = sessionsPerWeek(views, now);
  const outcomes: OutcomeRow[] = outcomeRows.map((r) => ({
    userId: String(r.user_id),
    kind: String(r.kind),
    outcome: String(r.outcome),
    at: new Date(r.happened_at as string),
  }));
  const completed = completion(outcomes);
  const cannot = cannotTell({ prediction: predicted, bands, agreement: agreed, sessions: learnSessions, completion: completed });

  console.log(`Learn measures, ${day(now)}`);
  console.log(
    `${harness.rows.length} graded answers in the export (${harness.probes} probes, ${harness.cellQuestions} cell questions); ` +
      `${scored.length} carry a predicted strength.\n`,
  );

  console.log(`1. Next-answer prediction (${predicted.answers} answers, the latest ${Math.round(HELD_OUT_SHARE * 100)}% held out)`);
  console.log(`   earlier ${predicted.before}, held out ${predicted.held}${predicted.heldFrom ? ` from ${day(predicted.heldFrom)}` : ''}`);
  console.log(`   AUC ${fixed(predicted.auc)}  (0.5 is a coin toss, 1 ranks every right answer above every wrong one)`);
  console.log(
    `   log loss ${fixed(predicted.logLoss)}` +
      (predicted.baselineShare === null || predicted.baselineLogLoss === null
        ? ' (no earlier answers to set a baseline)'
        : `, against ${fixed(predicted.baselineLogLoss)} for always guessing ${pct(predicted.baselineShare, 1)} right, the earlier share`) +
      '; lower is better',
  );
  printCannot(cannot.prediction);

  console.log(`\n2. Calibration by predicted band (${scored.length} answers)`);
  for (const b of bands) {
    const mean = b.meanPredicted === null ? '' : `, predicted ${pct(b.meanPredicted, 1)} on average`;
    console.log(`   ${b.label}  ${b.right} of ${b.answers} right (${pct(b.right, b.answers)})${mean}`);
  }
  console.log(`   Bands are ${BAND_EDGES.length - 1} equal widths of the strength score, 0 to 1.`);
  printCannot(cannot.calibration);

  console.log(`\n3. Grader agreement (${agreed.answers} answers with two verdicts, ${agreed.pairs} cells both judged)`);
  console.log(
    `   Cohen's kappa ${fixed(agreed.kappa, 2)}` +
      (agreed.standardError === null ? '' : `, give or take ${(1.96 * agreed.standardError).toFixed(2)}`) +
      (agreed.observed === null ? '' : `; agreed on ${pct(agreed.observed, 1)}, chance alone ${pct(agreed.expected ?? 0, 1)}`),
  );
  printCannot(cannot.agreement);

  console.log('\n4. Sessions per week (a gap over 30 minutes starts a new one)');
  printSessions('Learn', learnSessions);
  printSessions('whole app', appSessions);
  printCannot(cannot.sessions);

  console.log(`\n5. Completion, rows Learn picked against readings you queued (${outcomes.length} outcomes)`);
  printCompletion(completed.picked);
  printCompletion(completed.queued);
  printCannot(cannot.completion);

  await sql.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
