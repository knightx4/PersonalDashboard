/**
 * Check whether a step that changed a screen may close (plan #1534).
 *
 *   npm run ui-guard -- <step> [--commit <sha>] [--accept | --settle "<why>"]
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
 */
import postgres from 'postgres';
import {
  isScreenFile,
  uiAcceptSql,
  uiCheckRefusal,
  uiGuardSql,
  uiSettleSql,
  type CheckRound,
} from '../lib/plan/ui-check-guard';
import { localGit, stepScreenInputs } from '../lib/plan/ui-check-local';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
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
  const databaseUrl = process.env.DATABASE_URL;
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
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
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
    .find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--commit' && all[i - 1] !== '--settle');
  const accept = process.argv.includes('--accept');
  const settle = process.argv.includes('--settle') ? (arg('--settle') ?? '') : null;
  const written = (stepArg ?? '').trim().replace(/^#/, '');
  if (!/^\d+(?:\.\d+)*$/.test(written) || Number(written) === 0) {
    fail('npm run ui-guard -- <step> [--commit <sha>] [--accept | --settle "<why>"]');
  }
  if (settle !== null && !settle.trim()) fail('--settle needs the reason: --settle "<why>".');
  const { step, outline } = await placeStep(written);
  const name = `#${outline ?? step}`;
  const commit = arg('--commit') ?? localGit(['rev-parse', 'HEAD']).trim();

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

  const databaseUrl = process.env.DATABASE_URL;
  if (settle !== null) {
    const statement = uiSettleSql(step, surfaces, settle);
    if (!databaseUrl) {
      console.log('\nRun this through the Supabase connector. It settles each surface still waiting.\n');
      console.log(statement);
      return;
    }
    const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
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
    const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
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

  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const checks = await sql<CheckRound[]>`
      select c.surface, c.round, c.verdict from ui_checks c
      where c.step = ${step}
        and c.user_id = (select p.user_id from plan_items p where p.number = ${step} limit 1)`;
    const refusal = uiCheckRefusal({ step, outline, files, surfaces, checks });
    if (refusal) fail(refusal);
    console.log(`Every surface has passed: ${name} may close.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
