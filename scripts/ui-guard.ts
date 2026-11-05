/**
 * Check whether a step that changed a screen may close (plan #1534).
 *
 *   npm run ui-guard -- <step> [--commit <sha>] [--accept | --settle "<why>" | --compare [--workers <n>]]
 *
 * <step> is the outline the plan reads (`1073.4`) or the stored number. An
 * outline is looked up in plan_item_outlines, so it needs DATABASE_URL;
 * without one, give the number.
 *
 * The same check `scripts/plan.ts done` makes, for a session that closes
 * through the Supabase connector because it has no DATABASE_URL
 * (.claude/skills/plan/reference/offline.md). It reads the step's changed
 * files from git at the commit the close will record (HEAD by default),
 * names the gallery surfaces they serve, and then:
 *
 *   - with DATABASE_URL, reads the step's rounds from ui_checks and says
 *     whether it may close, exiting 1 when it may not;
 *   - without it, prints the statement to run through the connector. Every
 *     row it returns is a surface that has not passed, and the step does not
 *     close while there is one.
 *
 * A step that changed no screen file prints that and exits 0.
 *
 * With `--accept`, for a step whose block the person has answered with an
 * accept, it writes (or prints, without DATABASE_URL) an `accepted` round
 * for each surface that has not passed, and only when the step's comment
 * carries an `Answered` line newer than its last block (`uiAcceptSql`).
 *
 * With `--settle "<why>"`, the builder settles the surfaces still waiting
 * itself (`uiSettleSql`): one still failing after the critic's third round,
 * or one reached only through a shared file. Design checks are not put to the
 * person (their answer of 12 October 2026).
 *
 * The second kind is settled only when it looks the same as on main (plan
 * #2215.4): every surface the critic has not judged through three rounds has
 * its four shots in `.preview-shots/` compared with main's in
 * `.preview-shots/before/`, and the settle is refused, with nothing written
 * or printed, while any of them differs or is missing
 * (`lib/plan/ui-settle-diff.ts`). The rounds come from ui_checks with
 * DATABASE_URL, and from `.preview-shots/checks/` without it.
 *
 * With `--compare` (plan #2815.3, #2966.2) it does that shooting itself, as
 * the first stage of screen.md. Every surface its files serve that has not
 * passed, the ones the step names included, is shot on this checkout and on
 * origin/main (scripts/ui-guard-compare.ts), and those that look the same are
 * settled with the reason `SAME_AS_MAIN_REASON`. It prints how many it settled
 * and how many go to the critic, the surfaces that do, and how long building,
 * shooting and comparing took. It shoots the checkout it runs in, so
 * run it with the commit to compare checked out; `--commit <sha>` names the
 * commit the step's changed files are read at.
 *
 * With `--feature` (plan #2966.3), <step> is a feature and the check is its
 * land review, run on the feature branch head before the merge to main. The
 * surfaces are every one the branch's changes since `--base` (origin/main by
 * default) serve, and the rounds are the feature's own, counted only when
 * taken at a commit no screen file has changed since (lib/plan/ui-feature-review.ts).
 * It takes `--compare` and `--settle` as a step does, keeping the head on
 * every round it writes, and `--sheets`, which groups what is left by page
 * and draws each page's other states as one strip beside its main state, for
 * one critic round a page. Alone it says whether the feature may land.
 */
import postgres from 'postgres';
import { httpsSql, restTransport } from '../lib/db/https-sql';
import {
  isScreenFile,
  uiAcceptSql,
  uiCheckRefusal,
  layoutBlocked,
  uiGuardSql,
  uiSettleSql,
  type CheckRound,
} from '../lib/plan/ui-check-guard';
import { localGit, stepScreenInputs } from '../lib/plan/ui-check-local';
import {
  compareSurfaceShots,
  fileShotReader,
  localCheckRounds,
  settleRefusal,
  surfacesToCompare,
} from '../lib/plan/ui-settle-diff';
import { requireSupabaseProjectUrl } from '../lib/db/project';
import { compareReport, SAME_AS_MAIN_REASON, splitSurfaces } from '../lib/plan/ui-compare';
import { compareWithMain } from './ui-guard-compare';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { shotFile, SHOT_NAMES } from '../lib/preview/ui-checks';
import { branchScreenInputs } from '../lib/plan/ui-check-local';
import { featureUnpassed, pageGroups, roundsAtHead, type FeatureRound } from '../lib/plan/ui-feature-review';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/**
 * A client for the database, or null where neither DATABASE_URL nor the
 * service-role key is set. A cloud session's proxy carries HTTPS and not
 * Postgres, so there each statement goes through the REST API, as
 * scripts/plan.ts does.
 */
function reachableDatabase(): string | null {
  const url = process.env.DATABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key && (process.env.CLAUDE_CODE_REMOTE === 'true' || !url)) return 'https';
  return url ?? null;
}

function connect(target: string) {
  if (target === 'https') {
    const rest = requireSupabaseProjectUrl();
    return httpsSql(
      restTransport(rest, process.env.SUPABASE_SERVICE_ROLE_KEY as string),
    ) as unknown as ReturnType<typeof postgres>;
  }
  return postgres(target, { max: 1, prepare: false, onnotice: () => {} });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * The stored number and the outline of the step named on the command line.
 * An outline needs the database to say which number it is; a number without
 * a database goes ahead unnamed by outline.
 */
async function placeStep(written: string): Promise<{ step: number; outline: string | null }> {
  const databaseUrl = reachableDatabase();
  const isOutline = written.includes('.');
  if (!databaseUrl) {
    if (isOutline) {
      fail(
        `#${written} is an outline, and reading which step it is needs DATABASE_URL. Give the ` +
          `step's number instead: select number from plan_item_outlines where outline = '${written}'.`,
      );
    }
    return { step: Number(written), outline: null };
  }
  const sql = connect(databaseUrl);
  try {
    const rows = isOutline
      ? await sql<{ number: number; outline: string }[]>`
          select number, outline from plan_item_outlines where outline = ${written}`
      : await sql<{ number: number; outline: string }[]>`
          select number, outline from plan_item_outlines where number = ${Number(written)}`;
    if (isOutline && rows.length === 0) fail(`No step #${written}.`);
    if (rows.length > 1) fail(`#${written} names more than one step.`);
    return { step: rows[0]?.number ?? Number(written), outline: rows[0]?.outline ?? null };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const stepArg = process.argv
    .slice(2)
    .find(
      (a, i, all) =>
        !a.startsWith('--') && !['--commit', '--settle', '--workers', '--base'].includes(all[i - 1] ?? ''),
    );
  const accept = process.argv.includes('--accept');
  const compare = process.argv.includes('--compare');
  const settle = process.argv.includes('--settle') ? (arg('--settle') ?? '') : null;
  const written = (stepArg ?? '').trim().replace(/^#/, '');
  if (!/^\d+(?:\.\d+)*$/.test(written) || Number(written) === 0) {
    fail('npm run ui-guard -- <step> [--commit <sha>] [--accept | --settle "<why>" | --compare [--workers <n>]] [--feature [--base <ref>] [--sheets]]');
  }
  if ([accept, compare, process.argv.includes('--settle')].filter(Boolean).length > 1) {
    fail('Give one of --accept, --settle and --compare.');
  }
  if (settle !== null && !settle.trim()) fail('--settle needs the reason: --settle "<why>".');
  const { step, outline } = await placeStep(written);
  const name = `#${outline ?? step}`;
  const commit = arg('--commit') ?? localGit(['rev-parse', 'HEAD']).trim();

  if (process.argv.includes('--feature')) {
    if (accept) fail('--accept is for a step; a feature review settles or goes to the critic.');
    await featureRun({ name, feature: step, head: commit, compare, settle });
    return;
  }

  const { files, surfaces } = stepScreenInputs(step, commit, outline);
  if (!files.some(isScreenFile)) {
    console.log(`${name} changed no screen file at ${commit.slice(0, 7)}: nothing to check.`);
    return;
  }
  if (surfaces.length === 0) {
    console.log(`${name} changed a screen file that no gallery surface stands for: nothing to check.`);
    return;
  }
  console.log(`${name} serves: ${surfaces.join(', ')}`);

  const databaseUrl = reachableDatabase();
  if (compare) {
    await compareRun({ name, step, files, surfaces, databaseUrl });
    return;
  }
  if (settle !== null) {
    // A surface the critic has not judged through three rounds is settled only
    // when its shots match main's (plan #2215.4).
    const checks = databaseUrl ? await stepRounds(databaseUrl, step) : localCheckRounds(step, process.cwd());
    const compare = surfacesToCompare(surfaces, checks);
    const read = fileShotReader(process.cwd());
    const comparisons = [];
    for (const surface of compare) comparisons.push(await compareSurfaceShots(surface, read));
    const refusal = settleRefusal(name, step, comparisons);
    if (refusal) fail(refusal);
    if (compare.length > 0) {
      console.log(`Shots match main's on ${compare.length === 1 ? compare[0] : `all ${compare.length}: ${compare.join(', ')}`}.`);
    }
    // A layout that differs from its reference is not the builder's to settle (plan #2966.5).
    const wrongLayout = layoutBlocked(checks);
    const settleable = surfaces.filter((s) => !wrongLayout.has(s));
    if (wrongLayout.size > 0) {
      console.log(
        `Not settled: ${[...wrongLayout].join(', ')} ${wrongLayout.size === 1 ? 'differs' : 'differ'} from the ` +
          `reference in layout. Fix the layout and run a round that answers yes, or leave it for the person's answer.`,
      );
    }
    const statement = uiSettleSql(step, settleable, settle);
    if (!statement) return;
    if (!databaseUrl) {
      console.log('\nRun this through the Supabase connector. It settles each surface still waiting.\n');
      console.log(statement);
      return;
    }
    const sql = connect(databaseUrl);
    try {
      const rows = await sql.unsafe(statement);
      console.log(
        rows.length === 0
          ? `Nothing written: every surface of ${name} had passed.`
          : `Settled ${rows.length} surface${rows.length === 1 ? '' : 's'} on ${name}.`,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }
  if (accept) {
    const statement = uiAcceptSql(step, surfaces);
    if (!databaseUrl) {
      console.log('\nRun this through the Supabase connector. It writes an accepted round for each');
      console.log('surface still waiting, and nothing unless the step has an answer newer than its block.\n');
      console.log(statement);
      return;
    }
    const sql = connect(databaseUrl);
    try {
      const rows = await sql.unsafe(statement);
      console.log(
        rows.length === 0
          ? `Nothing written: every surface had passed, or ${name} has no answer newer than its block.`
          : `Accepted ${rows.length} surface${rows.length === 1 ? '' : 's'} on ${name}.`,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }

  if (!databaseUrl) {
    console.log('\nRun this through the Supabase connector. No rows: it may close. Any row: it may not.\n');
    console.log(uiGuardSql(step, surfaces));
    return;
  }

  const checks = await stepRounds(databaseUrl, step);
  const refusal = uiCheckRefusal({ step, outline, files, surfaces, checks });
  if (refusal) fail(refusal);
  console.log(`Every surface has passed: ${name} may close.`);
}

/**
 * `--compare`: the named surfaces left for the critic, the rest shot on both
 * checkouts, the identical ones settled and the changed ones listed.
 */
async function compareRun(input: {
  name: string;
  step: number;
  files: string[];
  surfaces: string[];
  databaseUrl: string | null;
  /** A feature's rounds at its head, read by the caller (plan #2966.3). */
  rounds?: CheckRound[];
  /** The head a feature review settles at, kept on each settled round. */
  head?: string;
}): Promise<void> {
  const { name, step, files, surfaces, databaseUrl } = input;
  const checks =
    input.rounds ?? (databaseUrl ? await stepRounds(databaseUrl, step) : localCheckRounds(step, process.cwd()));
  const text = databaseUrl ? await stepText(databaseUrl, step) : '';
  const { named, reached } = splitSurfaces(surfaces, text, checks);
  if (!databaseUrl) {
    console.log("Without DATABASE_URL the step's own words cannot be read, so only surfaces the critic judged count as named.");
  }
  const workersArg = Number(arg('--workers') ?? '3');
  const workers = Number.isFinite(workersArg) && workersArg >= 1 ? Math.min(Math.floor(workersArg), 5) : 3;
  // The surfaces the step names are compared with the rest (plan #2966.2): one
  // with no visible change is settled, and only a changed one reaches the critic.
  const toCompare = [...named, ...reached];
  if (toCompare.length === 0) {
    console.log(`Every surface ${name} serves has passed: nothing to compare.`);
    return;
  }
  console.log(`${toCompare.length} to compare with main (${named.length} named by the step, ${reached.length} reached through a shared file).`);
  const { comparisons, newOnBranch, timings } = await compareWithMain({
    root: process.cwd(),
    files,
    reached: toCompare,
    workers,
  });
  const report = compareReport({ name, step, comparisons, newOnBranch, timings });
  console.log(report.text);
  if (report.settled.length === 0) return;
  const statement = uiSettleSql(step, report.settled, SAME_AS_MAIN_REASON, input.head);
  if (!databaseUrl) {
    console.log('\nRun this through the Supabase connector. It settles the surfaces that look the same.\n');
    console.log(statement);
    return;
  }
  const sql = connect(databaseUrl);
  try {
    const rows = await sql.unsafe(statement);
    console.log(`Settled ${rows.length} surface${rows.length === 1 ? '' : 's'} that look the same as on main.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * `--feature` (plan #2966.3): the land review of a whole feature branch, run
 * on its head before the merge to main. Its surfaces come from everything the
 * branch changed since it left `--base` (origin/main by default), its rounds
 * are the ones recorded under the feature's number at a commit no screen file
 * has changed since, and what it settles carries the head.
 */
async function featureRun(input: {
  name: string;
  feature: number;
  head: string;
  compare: boolean;
  settle: string | null;
}): Promise<void> {
  const { name, feature, compare, settle } = input;
  const databaseUrl = reachableDatabase();
  if (!databaseUrl) {
    fail(`${name}'s land review reads the feature's rounds, which needs DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY.`);
  }
  const head = localGit(['rev-parse', input.head]).trim();
  const base = arg('--base') ?? 'origin/main';
  const { files, surfaces } = branchScreenInputs(base, head);
  if (!files.some(isScreenFile)) {
    console.log(`${name} changed no screen file since ${base}: nothing to review.`);
    return;
  }
  if (surfaces.length === 0) {
    console.log(`${name} changed screen files that no gallery surface stands for: nothing to review.`);
    return;
  }
  const all = await featureRounds(databaseUrl, feature);
  const counting = roundsAtHead(all, { contains: [], head, screenFiles: files }, localGit);
  const waiting = featureUnpassed(surfaces, all, counting);
  console.log(
    `${name} reaches ${surfaces.length} surface${surfaces.length === 1 ? '' : 's'} at ${head.slice(0, 9)}; ` +
      `${waiting.length} not yet passed there.`,
  );

  if (compare) {
    await compareRun({ name, step: feature, files, surfaces, databaseUrl, rounds: counting, head });
    return;
  }
  if (settle !== null) {
    // Only what has been through three rounds at the head, or looks the same
    // as on main, is the builder's to settle (plan #2215.4, #2966.5).
    const compared = surfacesToCompare(surfaces, counting);
    const read = fileShotReader(process.cwd());
    const comparisons = [];
    for (const surface of compared) comparisons.push(await compareSurfaceShots(surface, read));
    const refusal = settleRefusal(name, feature, comparisons);
    if (refusal) fail(refusal);
    const wrongLayout = new Set(waiting.filter((w) => w.layoutNo).map((w) => w.surface));
    if (wrongLayout.size > 0) {
      console.log(
        `Not settled: ${[...wrongLayout].join(', ')} differ${wrongLayout.size === 1 ? 's' : ''} from the reference in layout.`,
      );
    }
    const settleable = waiting.map((w) => w.surface).filter((s) => !wrongLayout.has(s));
    const statement = uiSettleSql(feature, settleable, settle, head);
    if (!statement) return;
    const sql = connect(databaseUrl);
    try {
      const rows = await sql.unsafe(statement);
      console.log(`Settled ${rows.length} surface${rows.length === 1 ? '' : 's'} on ${name} at ${head.slice(0, 9)}.`);
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }

  if (process.argv.includes('--sheets')) {
    const groups = pageGroups(waiting.map((w) => w.surface));
    console.log(`\n${groups.length} page${groups.length === 1 ? '' : 's'} for the critic, one round each:`);
    for (const group of groups) {
      const round = Math.max(0, ...all.filter((r) => r.surface === group.main).map((r) => r.round)) + 1;
      console.log(`\n${group.route}: ${group.main}, round ${round}`);
      console.log(`  main state: ${SHOT_NAMES.map((shot) => shotFile(group.main, shot)).join(', ')}`);
      if (group.states.length === 0) {
        console.log('  states: none');
      } else {
        const strip = await stateStrip(group.main, group.states);
        console.log(`  states (${group.states.join(', ')}): ${strip.file}`);
        if (strip.missing.length > 0) console.log(`  not shot yet: ${strip.missing.join(', ')} (npm run shoot -- <id>)`);
      }
      const states = group.states.length ? ` --states ${group.states.join(',')}` : '';
      console.log(`  record: npm run ui-check -- ${feature} ${group.main} ${round} --commit ${head.slice(0, 12)}${states}`);
    }
    return;
  }

  if (waiting.length === 0) {
    console.log(`Every surface has passed at the head: ${name} lands with its steps closed.`);
    return;
  }
  fail(
    `Not passed at ${head.slice(0, 9)}: ${waiting.map((w) => w.surface).join(', ')}. ` +
      `Run npm run ui-guard -- ${feature} --feature --compare, then --sheets for what goes to the critic.`,
  );
}

/**
 * One picture of a page's other states, side by side at phone width in the
 * light theme, so the critic judges them in the same round as the main state.
 * Each is cut at 1600 pixels tall; a state not shot yet is left out and named.
 */
async function stateStrip(main: string, states: readonly string[]): Promise<{ file: string; missing: string[] }> {
  const width = 390;
  const tallest = 1600;
  const gap = 24;
  const missing: string[] = [];
  const tiles: { input: Buffer; height: number }[] = [];
  for (const state of states) {
    const path = shotFile(state, 'phone-light');
    if (!existsSync(path)) {
      missing.push(state);
      continue;
    }
    const resized = await sharp(readFileSync(path)).resize({ width }).png().toBuffer({ resolveWithObject: true });
    const height = Math.min(resized.info.height, tallest);
    const input = await sharp(resized.data).extract({ left: 0, top: 0, width, height }).png().toBuffer();
    tiles.push({ input, height });
  }
  if (tiles.length === 0) return { file: 'none drawn yet', missing };
  mkdirSync('.preview-shots/sheets', { recursive: true });
  const file = `.preview-shots/sheets/${main}--states.png`;
  const canvasWidth = Math.max(1, tiles.length * width + Math.max(0, tiles.length - 1) * gap);
  const canvasHeight = Math.max(1, ...tiles.map((t) => t.height));
  await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: '#9ca3af' } })
    .composite(tiles.map((tile, i) => ({ input: tile.input, left: i * (width + gap), top: 0 })))
    .png()
    .toFile(file);
  return { file, missing };
}

/** The feature's own rounds in ui_checks, with the commit each was taken at. */
async function featureRounds(databaseUrl: string, feature: number): Promise<FeatureRound[]> {
  const sql = connect(databaseUrl);
  try {
    return await sql<FeatureRound[]>`
      select c.surface, c.round, c.verdict, (c.layout->>'ok')::boolean as layout_ok, c.commit_sha
      from ui_checks c
      where c.step = ${feature}
        and c.user_id = (select p.user_id from plan_items p where p.number = ${feature} limit 1)`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The step's title, detail and done-when, which name the surfaces it set out to change. */
async function stepText(databaseUrl: string, step: number): Promise<string> {
  const sql = connect(databaseUrl);
  try {
    const rows = await sql<{ title: string | null; detail: string | null; acceptance: string | null }[]>`
      select p.title, p.detail, p.acceptance from plan_items p where p.number = ${step} limit 1`;
    const row = rows[0];
    return row ? [row.title, row.detail, row.acceptance].filter(Boolean).join('\n') : '';
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The step's recorded rounds in ui_checks, under the account whose plan it is on. */
async function stepRounds(databaseUrl: string, step: number): Promise<CheckRound[]> {
  const sql = connect(databaseUrl);
  try {
    return await sql<CheckRound[]>`
      select c.surface, c.round, c.verdict, (c.layout->>'ok')::boolean as layout_ok from ui_checks c
      where c.step = ${step}
        and c.user_id = (select p.user_id from plan_items p where p.number = ${step} limit 1)`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
