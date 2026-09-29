/**
 * Check the chance number against past outcomes (plan #1204).
 *
 *   npx tsx scripts/chance-check.ts --closed <closed.json> --context <context.json> [--out <results.json>]
 *
 * Scores every closed application once with the same question the open ones
 * get (scoreApplication in lib/jobs/suggest/application-scores.ts), and
 * reports whether the ones that reached an interview rank higher on chance
 * than the rest. Nothing is written back to the applications.
 *
 * Each application is shown to Jev as though it were still waiting: its stage
 * reads "submitted", and its own row is left out of the history it is scored
 * against (excludeId). Otherwise the answer would be in the question.
 *
 * The two files are exports, for a session without DATABASE_URL:
 *
 *   closed.json: a JSON array of the closed applications (status rejected,
 *   withdrawn, ghosted or role_closed), each
 *   { id, status, title, company, seniority, location, workMode, compMinCents,
 *     compMaxCents, requirements, requirementMatches, jdText }
 *   from job_search.applications joined to roles and companies.
 *
 *   context.json: { evidence: string[] (evidence_items titles, strongest
 *   first, at most 40), targetTitles: string[] (profiles.target_titles),
 *   history: PastApplication[] (every application, newest first) }.
 *
 * Needs TYPESAFE_API_KEY. Prints the result and one spend row, summed per
 * model, to be recorded under jobs / score-applications.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { costMicrosFor, sumByModel, type SpendReport } from '../lib/core/spend/pricing';
import { scoreApplication, type ApplicationText } from '../lib/jobs/suggest/application-scores';
import { checkChance, type ChanceOutcome } from '../lib/jobs/suggest/chance-check';
import { reachedInterview, type PastApplication } from '../lib/jobs/suggest/history';
import type { ScoringContext } from '../lib/jobs/suggest/scores';

const argv = process.argv.slice(2);
function arg(flag: string): string | null {
  const at = argv.indexOf(flag);
  return at > -1 ? (argv[at + 1] ?? null) : null;
}

const closedPath = arg('--closed');
const contextPath = arg('--context');
if (!closedPath || !contextPath) {
  console.error('Usage: npx tsx scripts/chance-check.ts --closed <closed.json> --context <context.json> [--out <file>]');
  process.exit(1);
}

type Exported = { evidence: string[] | null; targetTitles: string[] | null; history: PastApplication[] };
const closed = JSON.parse(readFileSync(closedPath, 'utf8')) as ApplicationText[];
const exported = JSON.parse(readFileSync(contextPath, 'utf8')) as Exported;

const context: ScoringContext = {
  evidence: exported.evidence ?? [],
  targetTitles: exported.targetTitles ?? [],
  applied: exported.history
    .filter((app) => app.status !== 'lead')
    .map((app) => `${app.title} at ${app.company ?? 'an unnamed company'}`),
  roles: exported.history.map((app) => ({ title: app.title, company: app.company, status: app.status })),
  history: exported.history,
};
const byId = new Map(exported.history.map((app) => [app.id, app]));

const spend: SpendReport[] = [];
const rows: (ChanceOutcome & { title: string; confidence: number })[] = [];
let failed = 0;

async function scoreOne(app: ApplicationText): Promise<void> {
  const past = byId.get(app.id);
  if (!past) throw new Error(`Application ${app.id} is not in the history export.`);
  const result = await scoreApplication({
    application: { ...app, status: 'submitted' },
    context,
    onSpend: (report) => spend.push(report),
  });
  const chance = result.ok ? result.scores.chance : undefined;
  if (!chance) {
    failed += 1;
    console.error(`Not scored: ${app.title} (${result.ok ? 'no chance answer' : result.reason})`);
    return;
  }
  rows.push({ id: app.id, title: app.title, chance: chance.value, confidence: chance.confidence, interviewed: reachedInterview(past) });
}

async function main(): Promise<void> {
  // A few at a time: one by one takes minutes, and TypeSafe asks for a pause above a handful.
  const queue = [...closed];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let app = queue.shift(); app; app = queue.shift()) await scoreOne(app);
    }),
  );

  const check = checkChance(rows);
  const round = (n: number | null, places = 1) => (n === null ? null : Math.round(n * 10 ** places) / 10 ** places);
  console.log(`Scored ${check.scored} of ${closed.length} closed applications (${failed} failed).`);
  console.log(`Reached an interview: ${check.interviewed}.`);
  console.log(`AUC ${round(check.auc, 3)}; interviewed mean percentile ${round(check.meanPercentile)}.`);
  console.log(`Interviewed percentiles, highest first: ${check.interviewedPercentiles.map((p) => Math.round(p)).join(', ')}`);
  console.log(`Mean chance: interviewed ${round(check.meanChance.interviewed)}, rest ${round(check.meanChance.rest)}.`);
  console.log(`Tercile edges: ${JSON.stringify(check.edges)}; bands ${JSON.stringify(check.bands)}.`);
  console.log(`Display: ${check.display}.`);
  const summed = sumByModel(spend);
  for (const report of summed) {
    console.log(`Spend ${report.model}: ${JSON.stringify(report.usage)}, $${((costMicrosFor(report.model, report.usage) ?? 0) / 1e6).toFixed(4)}`);
  }
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify({ check, rows, spend: summed }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
