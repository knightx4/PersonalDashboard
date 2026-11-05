/**
 * The spread-and-repeat check for vault idea scores (plan #2947.4): score a
 * sample of map ideas twice with scoreIdea and print how far each score
 * spreads, how far the two runs differ, and how the types sorted them.
 * Writes nothing to the database.
 *
 *   npx tsx --conditions react-server scripts/idea-score-check.ts <sample.json> [rules.json] [results.json]
 *
 * `--conditions react-server` lets lib/jev/client.ts load under plain tsx.
 * Needs TYPESAFE_API_KEY. The sample file is what scripts/sql.ts prints for
 * the query in docs/trials/2026-11-05-idea-score-spread.md: rows of
 * { n, id, statement, basis, sources }, sources as scoreIdea takes them. The
 * rules file is the person's obsidian.vault_connections row as scripts/sql.ts
 * prints it; the default rules are used without it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { scoreIdea, type IdeaScore, type IdeaSource } from '../lib/vault/map/idea-score';
import { DEFAULT_VAULT_RULES } from '../lib/vault/map/rules';
import { rulesFromRow } from '../lib/vault/map/vault-rules';
import { jevApiKey } from '../lib/jev/wire';

type SampleRow = { n: number; id: string; statement: string; basis: string; sources: IdeaSource[] | null };
type Answer = { n: number; score: IdeaScore | null; failure: string | null };

const CONCURRENCY = 5;
/** The two runs may differ by this much on a score and still count as the same. */
const REPEAT_TOLERANCE = 5;

async function scoreAll(rows: SampleRow[], rules: typeof DEFAULT_VAULT_RULES, tokens: { input: number; output: number }) {
  const answers: Answer[] = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const index = next++;
      const row = rows[index];
      const result = await scoreIdea({
        idea: { statement: row.statement, basis: row.basis, sources: row.sources ?? [] },
        rules,
        onSpend: (report) => {
          tokens.input += report.usage.inputTokens;
          tokens.output += report.usage.outputTokens;
        },
      });
      answers[index] = result.ok
        ? { n: row.n, score: result.score, failure: null }
        : { n: row.n, score: null, failure: `${result.reason}: ${result.detail}` };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, rows.length)) }, worker));
  return answers;
}

/** Lowest, highest, and how many fall in each band of 20 (80 to 100 is the last). */
function spread(values: number[]): { low: number; high: number; bands: number[] } | null {
  if (values.length === 0) return null;
  const bands = [0, 0, 0, 0, 0];
  for (const value of values) bands[Math.min(4, Math.floor(value / 20))]++;
  return { low: Math.min(...values), high: Math.max(...values), bands };
}

async function main() {
  const [samplePath, rulesPath, outPath] = process.argv.slice(2);
  if (!samplePath) throw new Error('Pass the sample file.');
  if (!jevApiKey()) throw new Error('TYPESAFE_API_KEY is not set.');
  const rows = JSON.parse(readFileSync(samplePath, 'utf8')) as SampleRow[];
  const rules = rulesPath
    ? rulesFromRow((JSON.parse(readFileSync(rulesPath, 'utf8')) as Record<string, unknown>[])[0] ?? {})
    : DEFAULT_VAULT_RULES;

  const tokens = { input: 0, output: 0 };
  const first = await scoreAll(rows, rules, tokens);
  const second = await scoreAll(rows, rules, tokens);
  if (outPath) writeFileSync(outPath, JSON.stringify({ first, second, tokens }, null, 2));

  console.log('| # | type (run 1, run 2) | usefulness | novelty |');
  console.log('| ---: | --- | --- | --- |');
  for (let i = 0; i < rows.length; i++) {
    const a = first[i];
    const b = second[i];
    const type = `${a.score?.ideaType ?? a.failure} / ${b.score?.ideaType ?? b.failure}`;
    const pair = (key: 'usefulness' | 'novelty') =>
      a.score?.[key] == null && b.score?.[key] == null ? '' : `${a.score?.[key] ?? '-'}, ${b.score?.[key] ?? '-'}`;
    console.log(`| ${rows[i].n} | ${type} | ${pair('usefulness')} | ${pair('novelty')} |`);
  }

  for (const key of ['usefulness', 'novelty'] as const) {
    for (const [label, run] of [['run 1', first], ['run 2', second]] as const) {
      const values = run.flatMap((answer) => (answer.score?.[key] == null ? [] : [answer.score[key] as number]));
      const s = spread(values);
      console.log(`${key}, ${label}: ${values.length} scored` + (s ? `, ${s.low} to ${s.high}, bands of 20: ${s.bands.join(' / ')}` : ''));
    }
  }

  const both = rows
    .map((_, i) => [first[i].score, second[i].score] as const)
    .filter(([a, b]) => a?.usefulness != null && b?.usefulness != null);
  const differences = both.map(([a, b]) => ({
    usefulness: Math.abs(a!.usefulness! - b!.usefulness!),
    novelty: Math.abs(a!.novelty! - b!.novelty!),
  }));
  const steady = differences.filter((d) => d.usefulness <= REPEAT_TOLERANCE && d.novelty <= REPEAT_TOLERANCE).length;
  const sameType = rows.filter((_, i) => first[i].score && first[i].score?.ideaType === second[i].score?.ideaType).length;
  console.log(`Scored in both runs: ${both.length}; within ${REPEAT_TOLERANCE} points on both scores: ${steady}`);
  if (differences.length > 0) {
    console.log(
      `Largest difference: usefulness ${Math.max(...differences.map((d) => d.usefulness))}, ` +
        `novelty ${Math.max(...differences.map((d) => d.novelty))}`,
    );
  }
  console.log(`Same type in both runs: ${sameType} of ${rows.length}`);
  console.log(`Tokens: ${tokens.input} in, ${tokens.output} out`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
