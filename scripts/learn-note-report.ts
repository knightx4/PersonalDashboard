/**
 * How many concepts your notes propose, and how many of them you approve
 * (plan #1721, under #1717).
 *
 *   npm run note-report
 *   npm run note-report -- --rerun --limit 5
 *   npm run note-report -- --rerun --subject Economics --user you@example.com
 *
 * The first form reads learn.note_reads, the row each reading of a note leaves
 * behind (counts when the concepts are proposed, approval when you add them),
 * and prints concepts per note and the approved share. The rows are split at
 * the day the second check landed. Readings before it left no row, because
 * nothing recorded the proposals that were not approved, so "before" shows
 * only the concepts from notes that were approved, with no share to give.
 * Turning a proposal down is not a separate choice in the app; a reading whose
 * concepts were never added counts as not approved.
 *
 * `--rerun` runs the extractor and the check over notes you already have,
 * saving nothing, and prints what the extraction found against what the check
 * kept. It calls the model, so it spends money on the account named by
 * `--user` (or the only account there is), recorded in core.model_spend under
 * the same operations as the app. `--subject` names the subject whose concepts
 * the notes are read against (default: the one with the most concepts), and
 * `--limit` caps how many notes are read (default 5).
 *
 * Needs DATABASE_URL, and ANTHROPIC_API_KEY for `--rerun`. Run with
 * `--conditions=react-server`, which the npm script adds, for the same reason
 * as scripts/learn-catalogue.ts: the extractor is a server-only module.
 */
import postgres from 'postgres';
import { conceptsFromNote } from '../lib/learn/graph/from-note';
import { summariseNoteReads, type NoteReadRow } from '../lib/learn/graph/note-reads';
import { collectSpend } from '../lib/learn/spend';
import { costMicrosFor } from '../lib/core/spend/pricing';

/** The day the second check on a note's concepts went in (plan #1718). */
const JUDGE_DATE = '2026-10-10';

function args(argv: string[]) {
  const out = { rerun: false, limit: 5, subject: null as string | null, user: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--rerun') out.rerun = true;
    else if (arg === '--limit') out.limit = Number(argv[(i += 1)]) || out.limit;
    else if (arg === '--subject') out.subject = argv[(i += 1)] ?? null;
    else if (arg === '--user') out.user = argv[(i += 1)] ?? null;
  }
  return out;
}

function percent(value: number | null): string {
  return value === null ? 'none shown' : `${Math.round(value * 100)}%`;
}

function line(label: string, rows: NoteReadRow[]): void {
  const s = summariseNoteReads(rows);
  if (s.reads === 0) {
    console.log(`${label}: no readings recorded`);
    return;
  }
  console.log(
    `${label}: ${s.reads} readings, ${s.proposedPerNote.toFixed(1)} found per note, ` +
      `${s.perNote.toFixed(1)} shown per note (${s.empty} showed none), ` +
      `${s.approved} of ${s.shown} approved (${percent(s.approvedShare)})`,
  );
}

async function resolveUser(sql: postgres.Sql, wanted: string | null): Promise<string> {
  const rows = wanted
    ? await sql<{ id: string }[]>`
        select id from auth.users where id::text like ${`${wanted}%`} or email like ${`${wanted}%`}`
    : await sql<{ id: string }[]>`select id from auth.users limit 2`;
  if (rows.length !== 1) {
    console.error(rows.length === 0 ? 'No account found.' : 'More than one account: name one with --user.');
    process.exit(1);
  }
  return rows[0].id;
}

async function report(sql: postgres.Sql, userId: string): Promise<void> {
  const rows = await sql<(NoteReadRow & { created_at: Date })[]>`
    select proposed, kept, weak, approved_at, approved_count, created_at
      from learn.note_reads where user_id = ${userId} order by created_at`;
  const cutoff = new Date(`${JUDGE_DATE}T00:00:00Z`);

  const before = await sql<{ n: number }[]>`
    select count(*)::int as n from learn.concepts
     where user_id = ${userId} and origin = 'generated' and judge_verdict is null
       and created_at < ${cutoff} and basis ilike '%note%'`;
  console.log(
    `Before the check (to ${JUDGE_DATE}): ${before[0].n} concepts from notes were approved; ` +
      'the proposals that were not were never recorded, so there is no per-note count or share.',
  );
  line(`From ${JUDGE_DATE}`, rows.filter((r) => r.created_at >= cutoff));
  line('All recorded', rows);
}

async function rerun(
  sql: postgres.Sql,
  userId: string,
  options: { limit: number; subject: string | null },
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('--rerun needs ANTHROPIC_API_KEY.');
    process.exit(1);
  }

  const subjects = options.subject
    ? await sql<{ id: string; name: string }[]>`
        select id, name from learn.subjects
         where user_id = ${userId} and name ilike ${`${options.subject}%`} limit 1`
    : await sql<{ id: string; name: string }[]>`
        select s.id, s.name from learn.subjects s
          left join learn.concepts c on c.subject_id = s.id
         where s.user_id = ${userId}
         group by s.id order by count(c.id) desc limit 1`;
  if (subjects.length === 0) {
    console.error('No subject to read the notes against.');
    process.exit(1);
  }
  const subject = subjects[0];
  const existing = await sql<{ id: string; name: string }[]>`
    select id, name from learn.concepts where subject_id = ${subject.id} order by name`;
  const notes = await sql<{ title: string; note: string }[]>`
    select coalesce(s.title, r.id::text) as title, r.note
      from learn.readings r left join learn.sources s on s.id = r.source_id
     where r.user_id = ${userId} and nullif(trim(r.note), '') is not null
     order by r.created_at desc limit ${options.limit}`;

  console.log(`Re-reading ${notes.length} notes against "${subject.name}" (${existing.length} concepts). Nothing is saved.`);
  const extraction = collectSpend();
  const judging = collectSpend();
  let found = 0;
  let shown = 0;
  for (const n of notes) {
    const result = await conceptsFromNote({
      subject: subject.name,
      readingTitle: n.title,
      note: n.note,
      existing,
      anthropicApiKey: apiKey,
      onSpend: extraction.sink,
      onJudgeSpend: judging.sink,
    });
    if (!result.ok && result.reason === 'error') {
      console.log(`  ${n.title}: failed (${result.detail})`);
      continue;
    }
    const c = result.counts;
    found += c.proposed;
    shown += c.kept + c.weak;
    console.log(`  ${n.title}: found ${c.proposed}, kept ${c.kept}, weak ${c.weak}, dropped ${c.dropped}`);
  }
  console.log(`Found ${found} in total, shown ${shown}.`);

  for (const [operation, reports] of [
    ['concepts-from-note', extraction.reports],
    ['judge-note-concepts', judging.reports],
  ] as const) {
    for (const r of reports) {
      await sql`
        insert into core.model_spend (user_id, module, operation, model, input_tokens,
                                      cached_input_tokens, cache_write_tokens, output_tokens, cost_micros)
        values (${userId}, 'learn', ${operation}, ${r.model}, ${r.usage.inputTokens},
                ${r.usage.cachedInputTokens}, ${r.usage.cacheWriteTokens}, ${r.usage.outputTokens},
                ${costMicrosFor(r.model, r.usage)})`;
    }
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const opts = args(process.argv.slice(2));
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => {} });
  try {
    const userId = await resolveUser(sql, opts.user);
    if (opts.rerun) await rerun(sql, userId, opts);
    else await report(sql, userId);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
