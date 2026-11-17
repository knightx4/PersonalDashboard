/**
 * Check the chance number against past outcomes (plan #1204), and fit the
 * rubric's chance weights to them (17 November 2026).
 *
 *   npx tsx scripts/chance-check.ts --closed <closed.json> --context <context.json> [--out <results.json>]
 *   npx tsx scripts/chance-check.ts --refit <results.json>
 *
 * The first form scores every closed application once with the rubric the
 * open ones get (scoreApplication in lib/jobs/suggest/application-scores.ts),
 * keeps every factor answer, reports how well the chance ranks the ones that
 * reached an interview, and fits CHANCE_WEIGHTS to the answers
 * (lib/jobs/suggest/chance-fit.ts). The second refits from a saved run
 * without asking Jev again. Nothing is written back to the applications.
 *
 * Each application is shown to Jev as though it were still waiting: its stage
 * reads "submitted", and the history it is read against holds only the
 * applications sent before it. Otherwise the answer would be in the question,
 * as it partly was in the run of 24 October.
 *
 * The two files are exports, for a session without DATABASE_URL:
 *
 *   closed.json: a JSON array of ApplicationText plus `sentAt`, the closed
 *   applications (status rejected, withdrawn, ghosted or role_closed).
 *
 *   context.json: { evidence, targetTitles, history: PastApplication[]
 *   (every application, newest first), careerGoals, excludedIndustries,
 *   preferences } as loadScoringContext reads them.
 *
 * Needs TYPESAFE_API_KEY for the first form. Prints one spend row, summed per
 * model, to be recorded under jobs / score-applications.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { costMicrosFor, sumByModel, type SpendReport } from '../lib/core/spend/pricing';
import { scoreApplication, type ApplicationText } from '../lib/jobs/suggest/application-scores';
import { aucUnder, calibration, crossValidatedAuc, fitChanceWeights, type FitRow } from '../lib/jobs/suggest/chance-fit';
import { checkChance, type ChanceOutcome } from '../lib/jobs/suggest/chance-check';
import { reachedInterview, type PastApplication } from '../lib/jobs/suggest/history';
import { readPreferences } from '../lib/jobs/suggest/preferences';
import { CHANCE_WEIGHTS, combineChance, type ChanceWeights, type RubricBreakdown } from '../lib/jobs/suggest/rubric';
import type { ScoringContext } from '../lib/jobs/suggest/scores';

const argv = process.argv.slice(2);
function arg(flag: string): string | null {
  const at = argv.indexOf(flag);
  return at > -1 ? (argv[at + 1] ?? null) : null;
}

type Row = ChanceOutcome & { title: string; confidence: number; sentAt: string | null; rubric: RubricBreakdown };
const round = (n: number | null, places = 3) => (n === null ? null : Math.round(n * 10 ** places) / 10 ** places);

function report(rows: Row[]): void {
  // Recomputed under the weights in rubric.ts now, not as stored when scored.
  const check = checkChance(rows.map((row) => ({ ...row, chance: combineChance(row.rubric.chance).value })));
  console.log(`Reached an interview: ${check.interviewed} of ${check.scored}.`);
  console.log(`Current weights: AUC ${round(check.auc)}; interviewed mean percentile ${round(check.meanPercentile, 1)}.`);
  console.log(`Mean chance: interviewed ${round(check.meanChance.interviewed, 1)}, rest ${round(check.meanChance.rest, 1)}.`);
  console.log(`Tercile edges: ${JSON.stringify(check.edges)}; bands ${JSON.stringify(check.bands)}.`);

  // In the order sent, so the folds mix early and late applications evenly.
  const ordered = [...rows].sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''));
  const fitRows: FitRow[] = ordered.map((row) => ({ chance: row.rubric.chance, interviewed: row.interviewed }));
  const fitted = fitChanceWeights(fitRows);
  console.log(`Fitted weights: ${JSON.stringify(fitted)}`);
  console.log(`AUC with fitted weights, in sample: ${round(aucUnder(fitRows, fitted))}; cross-validated: ${round(crossValidatedAuc(fitRows))}.`);
  const before = calibration(fitRows, CHANCE_WEIGHTS);
  const after = calibration(fitRows, fitted);
  console.log(
    `Calibration (mean predicted vs actual): current ${round(before.predicted)} vs ${round(before.actual)}, fitted ${round(after.predicted)} vs ${round(after.actual)}.`,
  );
  for (const key of ['chance_requirements', 'chance_level', 'chance_background', 'chance_blocker', 'chance_competition'] as const) {
    const auc = aucUnder(fitRows, { ...Object.fromEntries(Object.keys(CHANCE_WEIGHTS).map((k) => [k, 0])), [key]: 1 } as ChanceWeights);
    console.log(`  ${key} alone: AUC ${round(auc)}`);
  }
  console.log(`  base rate alone: AUC ${round(aucUnder(fitRows, { ...Object.fromEntries(Object.keys(CHANCE_WEIGHTS).map((k) => [k, 0])), base: 1 } as ChanceWeights))}`);
}

async function score(closedPath: string, contextPath: string): Promise<void> {
  type Exported = {
    evidence: string[] | null;
    targetTitles: string[] | null;
    history: PastApplication[];
    careerGoals?: string[] | null;
    excludedIndustries?: string[] | null;
    preferences?: Record<string, unknown> | null;
  };
  const closed = JSON.parse(readFileSync(closedPath, 'utf8')) as (ApplicationText & { sentAt: string | null })[];
  const exported = JSON.parse(readFileSync(contextPath, 'utf8')) as Exported;
  const byId = new Map(exported.history.map((app) => [app.id, app]));

  /** The context as it stood when the application went in: only what was sent before it. */
  function contextAsOf(sentAt: string | null): ScoringContext {
    const history = sentAt ? exported.history.filter((app) => app.sentAt && app.sentAt < sentAt) : exported.history;
    return {
      evidence: exported.evidence ?? [],
      targetTitles: exported.targetTitles ?? [],
      applied: history.filter((app) => app.status !== 'lead').map((app) => `${app.title} at ${app.company ?? 'an unnamed company'}`),
      roles: history.map((app) => ({ title: app.title, company: app.company, status: app.status })),
      history,
      careerGoals: exported.careerGoals ?? [],
      excludedIndustries: exported.excludedIndustries ?? [],
      preferences: readPreferences(exported.preferences ?? null),
    };
  }

  const spend: SpendReport[] = [];
  const rows: Row[] = [];
  let failed = 0;
  async function scoreOne(app: ApplicationText & { sentAt: string | null }): Promise<void> {
    const past = byId.get(app.id);
    if (!past) throw new Error(`Application ${app.id} is not in the history export.`);
    const result = await scoreApplication({
      application: { ...app, status: 'submitted' },
      context: contextAsOf(app.sentAt),
      asOf: app.sentAt,
      onSpend: (r) => spend.push(r),
    });
    if (!result.ok || !result.scores.chance || !result.scores.rubric) {
      failed += 1;
      console.error(`Not scored: ${app.title} (${result.ok ? 'no chance answer' : result.reason})`);
      return;
    }
    rows.push({
      id: app.id,
      title: app.title,
      chance: result.scores.chance.value,
      confidence: result.scores.chance.confidence,
      interviewed: reachedInterview(past),
      sentAt: app.sentAt,
      rubric: result.scores.rubric,
    });
  }

  // A few at a time: one by one takes minutes, and TypeSafe asks for a pause above a handful.
  const queue = [...closed];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let app = queue.shift(); app; app = queue.shift()) await scoreOne(app);
    }),
  );
  console.log(`Scored ${rows.length} of ${closed.length} closed applications (${failed} failed).`);
  report(rows);
  const summed = sumByModel(spend);
  for (const r of summed) {
    console.log(`Spend ${r.model}: ${JSON.stringify(r.usage)}, $${((costMicrosFor(r.model, r.usage) ?? 0) / 1e6).toFixed(4)}`);
  }
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify({ rows, spend: summed }, null, 2));
}

async function main(): Promise<void> {
  const refit = arg('--refit');
  if (refit) {
    report((JSON.parse(readFileSync(refit, 'utf8')) as { rows: Row[] }).rows);
    return;
  }
  const closedPath = arg('--closed');
  const contextPath = arg('--context');
  if (!closedPath || !contextPath) {
    console.error('Usage: npx tsx scripts/chance-check.ts --closed <closed.json> --context <context.json> [--out <file>] | --refit <results.json>');
    process.exit(1);
  }
  await score(closedPath, contextPath);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
