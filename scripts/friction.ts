/**
 * What building this app keeps running into, and what was done about it
 * (migration 0303, lib/plan/friction.ts, .claude/skills/builder-loop).
 *
 *   npm run friction -- log "<what happened>" --kind <kind> [--lesson <key>] [--title "…"]
 *                          [--cost <minutes>] [--from <step>]
 *        # a builder records something that cost it time, as it happens
 *   npm run friction -- lessons [--all]
 *        # what builders keep running into, costliest first, with what to do
 *   npm run friction -- review [--days <n>]
 *        # the daily review's input: reads failed runs and critic fixes in,
 *        # then prints regressions, the ranked lessons and the friction no
 *        # lesson holds yet
 *   npm run friction -- file <id>[,<id>…] --lesson <key> [--title "…"]
 *   npm run friction -- teach <key> --lesson "what a builder should do" [--title "…"]
 *   npm run friction -- fixed <key> --fix "the commit and what now stops it"
 *   npm run friction -- wont-fix <key> --why "…"
 *   npm run friction -- reviewed --note "…" [--fixed <key>,…] [--taught <key>,…]
 *   npm run friction -- gate "<step>" --log <file>
 *        # scripts/gate.sh, when a check fails: filed by lint rule or check name
 *
 * Kinds: guard, gate, tool, mistake, misled, slow, stop, critic, writing.
 *
 * Log the moment something costs time, not only when a run stops: a guard
 * refusing, a check failing for the second time, a doc pointing the wrong
 * way, a command retried, a wrong guess undone. The tools record their own
 * refusals (plan.ts, the gate, the writing check); this is for the rest.
 *
 * Only the owner's account is read or written (core.dev_owner_id()).
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { httpsSql, restTransport } from '../lib/db/https-sql';
import { requireSupabaseProjectUrl } from '../lib/db/project';
import {
  clip,
  criticLesson,
  FRICTION_KINDS,
  gateLesson,
  isFrictionKind,
  isLessonKey,
  knownLesson,
  LESSON_MAX,
  lessonKey,
} from '../lib/plan/friction';
import { ensureLesson, loadRanked, recordFriction } from '../lib/plan/friction-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>;

const argv = process.argv.slice(2);

function arg(flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
}

/** The words not given as a flag or a flag's value. */
function positional(): string[] {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      if (!['--all'].includes(argv[i])) i += 1;
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function connect(): { sql: Sql; end: () => Promise<void> } {
  const url = process.env.DATABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key && (process.env.CLAUDE_CODE_REMOTE === 'true' || !url)) {
    const sql = httpsSql(restTransport(requireSupabaseProjectUrl(), key)) as unknown as Sql;
    return { sql, end: async () => {} };
  }
  if (!url) fail('Needs DATABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in a cloud session.');
  const pg = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  return { sql: pg as unknown as Sql, end: () => pg.end({ timeout: 5 }) };
}

async function ownerId(sql: Sql): Promise<string> {
  const [row] = await sql`select core.dev_owner_id() as id`;
  const id = row?.id as string | null;
  if (!id) fail('No owner is set (core.app_settings.owner_user_id).');
  return id;
}

/** The plan row a step's number or outline names, or null. */
async function stepId(sql: Sql, userId: string, written: string | null): Promise<string | null> {
  if (!written) return null;
  const text = written.replace(/^#/, '');
  const rows = /^\d+$/.test(text)
    ? await sql`select id from plan_items where user_id = ${userId} and number = ${Number(text)}`
    : await sql`
        select p.id from plan_item_outlines o join plan_items p on p.id = o.id
        where p.user_id = ${userId} and o.outline = ${text}`;
  if (!rows[0]) fail(`--from ${written} names no step.`);
  return rows[0].id as string;
}

function list(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
}

async function main() {
  const command = argv[0];
  if (!command || command === 'help' || command === '--help') {
    console.log('npm run friction -- log|lessons|review|file|teach|fixed|wont-fix|reviewed (see scripts/friction.ts)');
    return;
  }
  const { sql, end } = connect();
  try {
    const userId = await ownerId(sql);

    if (command === 'log') {
      const what = positional().join(' ').trim();
      if (!what) fail('log "<what happened>" --kind <kind> [--lesson <key>] [--cost <minutes>] [--from <step>]');
      const kind = arg('--kind') ?? 'mistake';
      if (!isFrictionKind(kind)) fail(`--kind is one of ${FRICTION_KINDS.join(', ')}.`);
      const costText = arg('--cost');
      const cost = costText === null ? null : Number(costText);
      if (cost !== null && !(Number.isInteger(cost) && cost >= 0 && cost <= 600)) fail('--cost is whole minutes, 0 to 600.');
      const given = arg('--lesson');
      if (given && !isLessonKey(given)) fail(`"${given}" is not a key: lower case words joined by hyphens.`);
      const lesson = given
        ? { key: given, title: arg('--title') ?? what }
        : knownLesson(what);
      const recorded = await recordFriction(sql, userId, {
        kind,
        what,
        lesson,
        cost,
        planItemId: await stepId(sql, userId, arg('--from')),
      });
      console.log(`Recorded ${recorded.id}${recorded.lessonKey ? ` under ${recorded.lessonKey}` : ', not yet under a lesson'}.`);
      if (recorded.recent > 1) console.log(`That lesson has been hit ${recorded.recent} times in 14 days.`);
      if (recorded.regressed) console.log('It was marked fixed and has come back; the next review takes it first.');
      if (recorded.lesson) console.log(`What to do: ${recorded.lesson}`);
      if (!recorded.lessonKey) {
        // Name the lessons it may belong to, so the next log can say --lesson.
        const mine = words(what);
        const ranked = await loadRanked(sql, userId);
        const near = ranked
          .map((l) => ({ l, shared: [...words(`${l.title} ${l.lesson ?? ''}`)].filter((w) => mine.has(w)).length }))
          .filter((x) => x.shared >= 2)
          .sort((a, b) => b.shared - a.shared)
          .slice(0, 3);
        if (near.length > 0) {
          console.log('It may belong to one of these; file it with npm run friction -- file <id> --lesson <key>:');
          for (const { l } of near) console.log(`  ${l.key}: ${l.title}`);
        }
      }
      return;
    }

    if (command === 'lessons') {
      const all = argv.includes('--all');
      const ranked = await loadRanked(sql, userId);
      const shown = all ? ranked : ranked.filter((l) => l.status !== 'fixed' || l.sinceFix > 0);
      if (shown.length === 0) {
        console.log('No lessons recorded yet.');
        return;
      }
      for (const l of shown) {
        const trend = l.before > 0 || l.count > 0 ? ` · ${l.count} in 14 days (${l.before} the 14 before) · ~${l.minutes} min` : '';
        const mark = l.sinceFix > 0 ? ' · REGRESSED' : '';
        console.log(`${l.key} [${l.status}]${trend}${mark}\n  ${l.title}`);
        if (l.lesson) console.log(`  Do: ${l.lesson}`);
        if (l.fix) console.log(`  Fixed by: ${l.fix}`);
      }
      return;
    }

    if (command === 'review') {
      const days = Number(arg('--days') ?? 14);
      const [last] = await sql`
        select created_at from build_reviews where user_id = ${userId} order by created_at desc limit 1`;
      const since = last?.created_at ?? new Date(Date.now() - days * 86400000).toISOString();

      // Failed runs' stop lines: one friction row each, filed when the words are known.
      const stops = await sql`
        select r.id, r.plan_item_id, r.stop_reason from plan_runs r
        where r.user_id = ${userId} and r.status = 'failed' and r.stop_reason is not null
          and r.created_at > now() - make_interval(days => ${days})
          and not exists (select 1 from build_friction f where f.run_id = r.id and f.kind = 'stop')`;
      for (const stop of stops) {
        await recordFriction(sql, userId, {
          kind: 'stop',
          what: stop.stop_reason as string,
          lesson: knownLesson(stop.stop_reason as string),
          planItemId: stop.plan_item_id as string,
          runId: stop.id as string,
          source: 'review',
        });
      }

      // The critic's fixes since the last review, by the law each breaks.
      const fixes = await sql`
        select c.fixes, p.id as plan_item_id, c.step, c.surface from ui_checks c
        left join plan_items p on p.user_id = c.user_id and p.number = c.step
        where c.user_id = ${userId} and c.verdict = 'fix' and c.created_at > ${since}`;
      // Written in one statement: a busy fortnight holds well over a thousand.
      const pending: { key: string; title: string; plan_item_id: string | null; what: string }[] = [];
      for (const row of fixes) {
        for (const fix of (row.fixes as { breaks?: string; problem?: string }[] | null) ?? []) {
          if (!fix.breaks) continue;
          const lesson = criticLesson(fix.breaks);
          pending.push({
            ...lesson,
            plan_item_id: (row.plan_item_id as string | null) ?? null,
            what: clip(`#${row.step} ${row.surface}: ${fix.problem ?? ''}`, 500),
          });
        }
      }
      const lessonIds = new Map<string, string>();
      for (const key of new Set(pending.map((p) => p.key))) {
        const first = pending.find((p) => p.key === key)!;
        const lesson = await ensureLesson(sql, userId, key, first.title);
        lessonIds.set(key, lesson.id);
        if (lesson.status === 'fixed') {
          await sql`
            update build_lessons set status = 'open', regressed_at = now(), updated_at = now()
            where id = ${lesson.id} and user_id = ${userId}`;
        }
      }
      if (pending.length > 0) {
        const rows = pending.map((p) => ({ lesson_id: lessonIds.get(p.key), plan_item_id: p.plan_item_id, what: p.what }));
        await sql`
          insert into build_friction (user_id, lesson_id, plan_item_id, kind, what, cost_minutes, source)
          select ${userId}, r.lesson_id, r.plan_item_id, 'critic', r.what, 10, 'review'
          from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(lesson_id uuid, plan_item_id uuid, what text)`;
      }
      const criticRows = pending.length;
      console.log(`Read in ${stops.length} failed run(s) and ${criticRows} critic fix(es) since ${new Date(since).toISOString().slice(0, 16)}.\n`);

      const ranked = await loadRanked(sql, userId);
      const regressions = ranked.filter((l) => l.sinceFix > 0);
      if (regressions.length > 0) {
        console.log('REGRESSIONS (fixed, and hit again: take these first)');
        for (const l of regressions) console.log(`  ${l.key}: ${l.sinceFix} since ${String(l.fixed_at).slice(0, 10)}. Fix was: ${l.fix}`);
        console.log('');
      }
      console.log('LESSONS BY COST, last 14 days');
      for (const l of ranked.filter((x) => x.count > 0).slice(0, 15)) {
        const grow = l.count > l.before ? '↑' : l.count < l.before ? '↓' : '=';
        console.log(`  ~${l.minutes} min · ${l.count}× ${grow} · ${l.key} [${l.status}]: ${l.title}`);
        if (l.lesson) console.log(`      Do: ${clip(l.lesson, 200)}`);
      }
      const unfiled = await sql`
        select f.id, f.kind, f.what, f.created_at from build_friction f
        where f.user_id = ${userId} and f.lesson_id is null and f.created_at > now() - make_interval(days => ${days})
        order by f.created_at desc limit 40`;
      if (unfiled.length > 0) {
        console.log('\nNOT YET UNDER A LESSON (file each: npm run friction -- file <id> --lesson <key> --title "…")');
        for (const f of unfiled) console.log(`  ${f.id} [${f.kind}] ${clip(f.what as string, 220)}`);
      }
      return;
    }

    if (command === 'file') {
      const ids = list(positional()[0] ?? null);
      const key = arg('--lesson');
      if (ids.length === 0 || !key) fail('file <id>[,<id>…] --lesson <key> [--title "…"]');
      if (!isLessonKey(key)) fail(`"${key}" is not a key; try ${lessonKey(key)}.`);
      const existing = await sql`select title from build_lessons where user_id = ${userId} and key = ${key}`;
      const title = arg('--title') ?? (existing[0]?.title as string | undefined);
      if (!title) fail(`No lesson ${key} yet: give it a --title.`);
      const lesson = await ensureLesson(sql, userId, key, title);
      const rows = await sql`
        update build_friction set lesson_id = ${lesson.id}
        where user_id = ${userId} and id = any(${ids}::uuid[]) returning id`;
      console.log(`Filed ${rows.length} under ${key}.`);
      return;
    }

    if (command === 'teach' || command === 'fixed' || command === 'wont-fix') {
      const key = positional()[0];
      if (!key) fail(`${command} <key> …`);
      const [row] = await sql`select id, status from build_lessons where user_id = ${userId} and key = ${key}`;
      if (!row) fail(`No lesson ${key}. npm run friction -- lessons --all lists them.`);
      const title = arg('--title');
      if (command === 'teach') {
        const lesson = arg('--lesson')?.trim();
        if (!lesson) fail('teach <key> --lesson "what a builder should do instead"');
        if (lesson.length > LESSON_MAX) fail(`Keep the lesson under ${LESSON_MAX} characters.`);
        await sql`
          update build_lessons
          set lesson = ${lesson}, title = coalesce(${title}, title),
              status = case when status = 'fixed' then status else 'taught' end, updated_at = now()
          where id = ${row.id} and user_id = ${userId}`;
        console.log(`${key} taught: every builder is shown it when claiming a step.`);
      } else if (command === 'fixed') {
        const fix = arg('--fix')?.trim();
        if (!fix) fail('fixed <key> --fix "the commit, and what now stops it"');
        await sql`
          update build_lessons
          set status = 'fixed', fix = ${clip(fix)}, fixed_at = now(), title = coalesce(${title}, title), updated_at = now()
          where id = ${row.id} and user_id = ${userId}`;
        console.log(`${key} fixed. Any friction filed under it from now on reopens it as a regression.`);
      } else {
        const why = arg('--why')?.trim();
        if (!why) fail('wont-fix <key> --why "…"');
        await sql`
          update build_lessons set status = 'wont_fix', fix = ${clip(`Won't fix: ${why}`)}, updated_at = now()
          where id = ${row.id} and user_id = ${userId}`;
        console.log(`${key} set aside.`);
      }
      return;
    }

    if (command === 'gate') {
      const step = positional()[0];
      const path = arg('--log');
      if (!step || !path) fail('gate "<step>" --log <file>');
      const log = readFileSync(path, 'utf8').split('\n').slice(-80).join('\n');
      const lesson = gateLesson(step, log);
      const first = log.split('\n').find((line) => /error|fail|✗|×/i.test(line)) ?? step;
      const recorded = await recordFriction(sql, userId, {
        kind: 'gate',
        what: `${step}: ${clip(first, 400)}`,
        lesson,
        cost: 5,
        source: 'tool',
      });
      if (recorded.recent > 1) {
        console.error(`gate: ${lesson.key} has failed ${recorded.recent} times in 14 days across builders.`);
      }
      if (recorded.lesson) console.error(`gate: what to do: ${recorded.lesson}`);
      return;
    }

    if (command === 'reviewed') {
      const note = arg('--note')?.trim();
      if (!note) fail('reviewed --note "what this review found and changed" [--fixed <key>,…] [--taught <key>,…]');
      await sql`
        insert into build_reviews (user_id, note, fixed, taught)
        values (${userId}, ${clip(note, 2000)}, ${list(arg('--fixed'))}, ${list(arg('--taught'))})`;
      console.log('Review recorded.');
      return;
    }

    fail(`Unknown command ${command}.`);
  } finally {
    await end();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
