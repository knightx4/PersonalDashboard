/**
 * Ask Jev to score a few ideas and print the answers (plan #1324).
 *
 *   npx tsx scripts/idea-scores.ts --ideas <ideas.json> [--sql <updates.sql>]
 *
 * Asks the question in lib/ideas/score.ts about each idea, through the same
 * scoreIdea the app uses, and prints the score out of 100 and Jev's
 * confidence. Nothing is written back to the ideas.
 *
 * With --sql it also writes one update per idea scored, for a session to run
 * through the Supabase connector: the catch-up (plan #1327) done by hand. Each
 * sets `ideas.score` only where it is still null, as the app's catch-up does.
 *
 * The file is an export, for a session without DATABASE_URL:
 *
 *   { "visions": { "<workspace id or app>": "<vision>", … },
 *     "ideas": [{ "id", "body", "module" (null for the app), "triage" (or null) }, …] }
 *
 * from public.module_visions and public.ideas. Needs TYPESAFE_API_KEY. Prints
 * one spend line per model at the end.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { costMicrosFor, sumByModel, type SpendReport } from '../lib/core/spend/pricing';
import { triageFrom } from '../lib/feedback/triage';
import { scoreIdea } from '../lib/ideas/score-ask';
import { ideaScoreView, visionForIdea } from '../lib/ideas/score';
import { isModuleId } from '../lib/modules';

const argv = process.argv.slice(2);
const at = argv.indexOf('--ideas');
const path = at > -1 ? argv[at + 1] : null;
const sqlAt = argv.indexOf('--sql');
const sqlPath = sqlAt > -1 ? argv[sqlAt + 1] : null;
if (!path) {
  console.error('Usage: npx tsx scripts/idea-scores.ts --ideas <ideas.json> [--sql <updates.sql>]');
  process.exit(1);
}

type Exported = {
  visions: Record<string, string>;
  ideas: { id: string; body: string; module: string | null; triage: unknown }[];
};
const exported = JSON.parse(readFileSync(path, 'utf8')) as Exported;
const visions = Object.fromEntries(
  Object.entries(exported.visions).map(([key, body]) => [key, { body }]),
);

async function main(): Promise<void> {
  const spend: SpendReport[] = [];
  let failed = 0;
  const updates: string[] = [];
  for (const idea of exported.ideas) {
    const workspace = idea.module && isModuleId(idea.module) ? idea.module : null;
    const result = await scoreIdea({
      body: idea.body,
      module: workspace,
      vision: visionForIdea(visions, workspace),
      triage: triageFrom(idea.triage),
      onSpend: (report) => spend.push(report),
    });
    const line = idea.body.split('\n')[0].slice(0, 80);
    if (!result.ok) {
      failed += 1;
      console.log(`${idea.id}  not scored (${result.reason}: ${result.detail})  [${workspace ?? 'app'}] ${line}`);
      continue;
    }
    const json = JSON.stringify(result.score).replaceAll("'", "''");
    const id = idea.id.replaceAll("'", "''");
    updates.push(`update ideas set score = '${json}'::jsonb where id = '${id}' and score is null;`);
    const view = ideaScoreView(result.score);
    console.log(
      `${idea.id}  score ${result.score.value}  confidence ${result.score.confidence}  shown "${view.text}" (${view.state})  [${workspace ?? 'app'}] ${line}`,
    );
  }
  console.log(`Scored ${exported.ideas.length - failed} of ${exported.ideas.length}.`);
  if (sqlPath) {
    writeFileSync(sqlPath, updates.join('\n') + '\n');
    console.log(`Wrote ${updates.length} updates to ${sqlPath}.`);
  }
  for (const report of sumByModel(spend)) {
    const dollars = (costMicrosFor(report.model, report.usage) ?? 0) / 1e6;
    console.log(`Spend ${report.model}: ${JSON.stringify(report.usage)}, $${dollars.toFixed(6)}`);
  }
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
