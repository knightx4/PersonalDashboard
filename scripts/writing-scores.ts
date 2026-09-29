/**
 * Score the last 100 plan rows against the writing guide (plan #1175), so the
 * warning and note thresholds in lib/writing/check.ts can be set from real
 * text rather than guessed.
 *
 *   npm run writing:scores -- [--user <account id>] [--limit 100]
 *   npm run writing:scores -- --json <rows.json>
 *
 * The first reads plan_items over DATABASE_URL, newest first, and asks Jev
 * only when the account has core.account_settings.jev_enabled on; it records
 * the spend under core / check-writing. The second reads a JSON array of
 * { number, title, detail, acceptance } rows, for a session without
 * DATABASE_URL that exported them another way, and asks Jev whenever
 * TYPESAFE_API_KEY is set. Nothing is written back to the rows.
 *
 * Prints each row that scored 0.5 or more on any pattern, then one line per
 * pattern: how many rows reached 0.5, the warning and the note, and the
 * median and 90th percentile of its scores.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { costMicrosFor, type SpendReport } from '../lib/core/spend/pricing';
import {
  checkWriting,
  WRITING_NOTE_AT,
  WRITING_PATTERN_IDS,
  WRITING_PATTERNS,
  WRITING_WARN_AT,
  type WritingPattern,
  type WritingScore,
} from '../lib/writing/check';
import { writingSpendRow } from '../lib/writing/ledger';

type Row = { number: number; title: string; detail: string | null; acceptance: string | null };

const argv = process.argv.slice(2);
function arg(flag: string): string | null {
  const at = argv.indexOf(flag);
  return at > -1 ? (argv[at + 1] ?? null) : null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

async function scoreAll(
  rows: Row[],
  enabled: boolean,
  onSpend: (report: SpendReport) => void,
): Promise<{ row: Row; result: WritingScore }[]> {
  const out: { row: Row; result: WritingScore }[] = [];
  const queue = [...rows];
  // Five at a time: Jev answers in under a second, and this is a hundred calls.
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const result = await checkWriting({
          text: { title: row.title, detail: row.detail, done_when: row.acceptance },
          enabled,
          onSpend,
        });
        out.push({ row, result });
      }
    }),
  );
  return out.sort((a, b) => b.row.number - a.row.number);
}

async function main(): Promise<void> {
  const limit = Number(arg('--limit') ?? 100);
  const jsonPath = arg('--json');
  let rows: Row[];
  let enabled = true;
  let sql: ReturnType<typeof postgres> | null = null;
  let userId: string | null = null;

  if (jsonPath) {
    rows = (JSON.parse(readFileSync(jsonPath, 'utf8')) as Row[]).slice(0, limit);
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set; pass --json <rows.json> instead.');
    sql = postgres(url, { max: 2, prepare: false, onnotice: () => {} });
    userId = arg('--user');
    if (!userId) {
      const owners = await sql<{ user_id: string }[]>`select distinct user_id from plan_items`;
      if (owners.length !== 1) throw new Error('More than one account has a plan; pass --user <id>.');
      userId = owners[0].user_id;
    }
    const [settings] = await sql<{ jev_enabled: boolean | null }[]>`
      select jev_enabled from core.account_settings where user_id = ${userId}`;
    enabled = settings?.jev_enabled === true;
    rows = await sql<Row[]>`
      select number, title, detail, acceptance from plan_items
      where user_id = ${userId}
      order by created_at desc limit ${limit}`;
  }

  const spend: SpendReport[] = [];
  const results = await scoreAll(rows, enabled, (report) => spend.push(report));
  if (sql && userId) {
    for (const report of spend) await sql`insert into core.model_spend ${sql(writingSpendRow(userId, report))}`;
    await sql.end({ timeout: 5 });
  }

  const failures = results.filter((r) => r.result.jevFailure).map((r) => r.result.jevFailure);
  console.log(
    `${results.length} rows scored${enabled ? '' : ' by the rules alone (jev_enabled is off)'}` +
      `${failures.length > 0 ? `; Jev did not answer for ${failures.length} (${[...new Set(failures)].join(', ')})` : ''}.`,
  );
  console.log('');

  for (const { row, result } of results) {
    const high = result.scores.filter((s) => s.score >= 0.5).sort((a, b) => b.score - a.score);
    if (high.length === 0) continue;
    const marks = high
      .map((s) => `${WRITING_PATTERNS[s.pattern].label} ${s.by === 'rule' ? 'rule' : s.score.toFixed(2)}`)
      .join(', ');
    console.log(`#${row.number} ${row.title.slice(0, 60)}\n    ${marks}`);
  }

  console.log('');
  console.log(`pattern                   >=0.5  >=${WRITING_WARN_AT} (warn)  >=${WRITING_NOTE_AT} (note)  median  p90`);
  for (const pattern of WRITING_PATTERN_IDS) {
    const scores = results
      .map((r) => r.result.scores.find((s) => s.pattern === pattern)?.score ?? 0)
      .sort((a, b) => a - b);
    const count = (at: number) => scores.filter((s) => s >= at).length;
    console.log(
      `${WRITING_PATTERNS[pattern as WritingPattern].label.padEnd(26)}${String(count(0.5)).padStart(5)}` +
        `${String(count(WRITING_WARN_AT)).padStart(12)}${String(count(WRITING_NOTE_AT)).padStart(14)}` +
        `${percentile(scores, 0.5).toFixed(2).padStart(8)}${percentile(scores, 0.9).toFixed(2).padStart(6)}`,
    );
  }

  const tokens = spend.reduce((sum, r) => sum + r.usage.inputTokens, 0);
  const micros = spend.reduce((sum, r) => sum + (costMicrosFor(r.model, r.usage) ?? 0), 0);
  console.log('');
  console.log(`${spend.length} Jev calls, ${tokens} input tokens, $${(micros / 1e6).toFixed(4)}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
