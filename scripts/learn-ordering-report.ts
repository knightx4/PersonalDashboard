/**
 * Does the order Learn offers things in match what you then do (plan #2154.1)?
 *
 *   npx tsx scripts/learn-ordering-report.ts [--user <id>] [--export <file.csv>]
 *
 * Reads learn.next_outcomes, learn.track_offers, learn.probes and
 * learn.cell_questions and prints:
 *
 *   1. outcomes by kind of row, and by place in a sitting;
 *   2. the tracks the flow would have weighted up 30 days ago and how many
 *      questions you answered in each since, then each track offer and what
 *      you answered after starting it;
 *   3. a summary of the harness export, one row per graded answer across
 *      probes and cell questions, with predicted strength, outcome, seconds
 *      from shown to answered and both graders' verdicts. --export writes
 *      every row as CSV;
 *   4. what the record cannot tell.
 *
 * Needs DATABASE_URL (service role), or SUPABASE_SERVICE_ROLE_KEY for the
 * HTTPS route a cloud session uses. Nothing is written back. The arithmetic
 * is lib/learn/ordering-report.ts.
 */
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { httpsSql, restTransport } from '../lib/db/https-sql';
import {
  CANNOT_TELL,
  exportRow,
  followOffers,
  followTracks,
  outcomesByKind,
  outcomesBySittingPlace,
  toCsv,
  type OfferRow,
  type OutcomeLine,
  type OutcomeRow,
  type ProbeEvent,
} from '../lib/learn/ordering-report';
import { loadHarnessExport } from '../lib/learn/harness-export';

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

const date = (value: unknown) => (value ? new Date(value as string | Date) : null);
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const pct = (part: number, whole: number) => (whole === 0 ? '-' : `${Math.round((part / whole) * 100)}%`);

function printLines(lines: OutcomeLine[], width: number) {
  for (const l of lines) {
    console.log(
      `   ${l.label.padEnd(width)} answered ${l.answered}, read ${l.read}, not now ${l.notNow}` +
        `  (not now ${pct(l.notNow, l.total)} of ${l.total})`,
    );
  }
}

async function main() {
  const sql = connect();
  const user = arg('--user');
  const now = new Date();
  const asOf = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const outcomeRows = (await sql`
    select user_id, kind::text as kind, outcome::text as outcome, happened_at
    from learn.next_outcomes
    where (${user}::uuid is null or user_id = ${user}::uuid)
    order by happened_at`) as unknown as Rows;
  const offerRows = (await sql`
    select theme_name, theme_strength, outcome::text as outcome, subject_id, happened_at
    from learn.track_offers
    where (${user}::uuid is null or user_id = ${user}::uuid)
    order by happened_at`) as unknown as Rows;
  const probeRows = (await sql`
    select c.subject_id, p.shown_at, p.answered_at
    from learn.probes p
    join learn.concepts c on c.id = p.concept_id and c.user_id = p.user_id
    where p.discarded_at is null and (${user}::uuid is null or p.user_id = ${user}::uuid)`) as unknown as Rows;
  const harness = await loadHarnessExport(sql, user);

  const outcomes: OutcomeRow[] = outcomeRows.map((r) => ({
    userId: String(r.user_id),
    kind: String(r.kind),
    outcome: String(r.outcome),
    at: date(r.happened_at)!,
  }));
  const events: ProbeEvent[] = probeRows.map((r) => ({
    subjectId: String(r.subject_id),
    shownAt: date(r.shown_at),
    answeredAt: date(r.answered_at),
  }));
  const offers: OfferRow[] = offerRows.map((r) => ({
    themeName: String(r.theme_name),
    themeStrength: num(r.theme_strength),
    outcome: String(r.outcome),
    subjectId: r.subject_id ? String(r.subject_id) : null,
    at: date(r.happened_at)!,
  }));

  console.log(`Learn ordering report, ${now.toISOString().slice(0, 10)}\n`);

  console.log(`1. What you did, by kind of row (${outcomes.length} outcomes)`);
  printLines(outcomesByKind(outcomes), 8);
  console.log('\n   By place in a sitting (a gap over 30 minutes starts a new one):');
  printLines(outcomesBySittingPlace(outcomes), 13);

  console.log(
    `\n2. Tracks by weight on ${asOf.toISOString().slice(0, 10)}, and questions answered in the 30 days since`,
  );
  const followed = followTracks(events, asOf);
  const up = followed.filter((t) => t.weightThen > 1);
  const rest = followed.filter((t) => t.weightThen <= 1);
  const mean = (list: typeof followed) =>
    list.length === 0 ? '-' : (list.reduce((s, t) => s + t.answeredAfter, 0) / list.length).toFixed(1);
  if (followed.length === 0) {
    const first = events.flatMap((e) => (e.answeredAt ? [e.answeredAt.getTime()] : [])).sort()[0];
    console.log(
      first === undefined
        ? '   No question has been answered yet.'
        : `   Nothing was answered before that day (the first answer is ${new Date(first).toISOString().slice(0, 10)}), so no track had a weight then.`,
    );
  }
  console.log(`   weighted up: ${up.length} tracks, ${mean(up)} answers each on average`);
  console.log(`   weight 1 or less: ${rest.length} tracks, ${mean(rest)} answers each on average`);
  for (const t of followed.slice(0, 15)) {
    console.log(`   ${t.subjectId.slice(0, 8)}  weight ${t.weightThen.toFixed(2)}  answered since ${t.answeredAfter}`);
  }
  console.log(`\n   New-track offers (${offers.length}):`);
  for (const o of followOffers(offers, events, now)) {
    const after =
      o.answeredAfter === null
        ? ''
        : `, ${o.answeredAfter} answers in the next 30 days${o.complete ? '' : ' (month not over)'}`;
    const strength = o.themeStrength === null ? '' : ` (strength ${o.themeStrength})`;
    console.log(`   ${o.at.toISOString().slice(0, 10)}  ${o.outcome.padEnd(8)} ${o.themeName}${strength}${after}`);
  }

  const rows = harness.rows.map(exportRow);
  const filled = (key: keyof (typeof rows)[number]) => rows.filter((r) => r[key] !== '').length;
  console.log(
    `\n3. Harness export: ${rows.length} graded answers (${harness.probes} probes, ${harness.cellQuestions} cell questions)`,
  );
  console.log(
    `   filled: predicted strength ${filled('predicted_strength')}, predicted status ${filled('predicted_status')}, ` +
      `seconds ${filled('seconds_shown_to_answered')}, outcome ${filled('outcome')}, ` +
      `grader 1 ${filled('grader_1')}, grader 2 ${filled('grader_2')}`,
  );
  console.log('   Probes keep a predicted strength and one verdict; cell questions keep a predicted status and level, and up to two graders.');
  const file = arg('--export');
  if (file) {
    writeFileSync(file, toCsv(rows));
    console.log(`   Wrote ${rows.length} rows to ${file}`);
  } else {
    console.log('   Pass --export <file.csv> to write every row.');
  }

  console.log('\n4. What this cannot tell');
  for (const line of CANNOT_TELL) console.log(`   - ${line}`);
  await sql.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
