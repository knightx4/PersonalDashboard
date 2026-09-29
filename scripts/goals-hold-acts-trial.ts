/**
 * The report-only trial for plan #1183: ask Jev the acts question about a set
 * of goal steps and print what the check would hold, writing nothing.
 *
 *   npx tsx scripts/goals-hold-acts-trial.ts <steps.json>
 *
 * The file is a JSON array of { id, title, detail, acceptance, status?,
 * label? }, exported from goals.items (the Claude steps, any status). `label`
 * is optional and is printed beside the answer, for invented cases whose
 * right answer is known. Needs TYPESAFE_API_KEY. The question, the state and
 * the 0.3 line are the ones the live check uses (lib/goals/hold-acts.ts), so
 * the trial reads what the check would do. The results written up are in
 * docs/trials/2026-09-29-goals-hold-acts.md.
 */
import { readFileSync } from 'node:fs';
import { ACTS_QUESTION, actsState, checkActs, HOLD_ACTS_THRESHOLD, type ActsCandidate } from '../lib/goals/hold-acts';
import { askJev, jevApiKey } from '../lib/jev/wire';

type TrialStep = ActsCandidate & { status?: string; label?: string };

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Pass the steps file.');
  if (!jevApiKey()) throw new Error('TYPESAFE_API_KEY is not set.');
  const steps = JSON.parse(readFileSync(path, 'utf8')) as TrialStep[];

  let inputTokens = 0;
  const failures: string[] = [];
  const checks = await checkActs(steps, async (step) => {
    const result = await askJev({
      state: actsState(step),
      question: ACTS_QUESTION,
      onSpend: (report) => {
        inputTokens += report.usage.inputTokens;
      },
    });
    if (!result.ok) {
      failures.push(`${step.id}: ${result.reason} ${result.detail}`);
      return null;
    }
    return result.answer.probability;
  });

  const rows = checks
    .map((check, index) => ({ ...check, extra: steps[index] }))
    .sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1));
  console.log(`| Yes | Held | Status | Label | Step |`);
  console.log(`| ---: | --- | --- | --- | --- |`);
  for (const row of rows) {
    const yes = row.probability === null ? 'failed' : row.probability.toFixed(3);
    console.log(
      `| ${yes} | ${row.held ? 'held' : ''} | ${row.extra.status ?? ''} | ${row.extra.label ?? ''} | ${row.step.title} |`,
    );
  }
  const held = checks.filter((check) => check.held).length;
  console.log(
    `\n${checks.length} steps, ${held} at or above ${HOLD_ACTS_THRESHOLD}, ${failures.length} failed, ${inputTokens} input tokens.`,
  );
  for (const failure of failures) console.log(`failed: ${failure}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
