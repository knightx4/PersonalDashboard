/**
 * Check whether a step that changed a screen may close (plan #1534).
 *
 *   npm run ui-guard -- <step> [--commit <sha>]
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
 */
import postgres from 'postgres';
import { isScreenFile, uiCheckRefusal, uiGuardSql, type CheckRound } from '../lib/plan/ui-check-guard';
import { localGit, stepScreenInputs } from '../lib/plan/ui-check-local';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const stepArg = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--commit');
  const step = Number((stepArg ?? '').replace(/^#/, ''));
  if (!Number.isInteger(step) || step < 1) fail('npm run ui-guard -- <step> [--commit <sha>]');
  const commit = arg('--commit') ?? localGit(['rev-parse', 'HEAD']).trim();

  const { files, surfaces } = stepScreenInputs(step, commit);
  if (!files.some(isScreenFile)) {
    console.log(`#${step} changed no screen file at ${commit.slice(0, 7)}: nothing to check.`);
    return;
  }
  if (surfaces.length === 0) {
    console.log(`#${step} changed a screen file that no gallery surface stands for: nothing to check.`);
    return;
  }
  console.log(`#${step} serves: ${surfaces.join(', ')}`);

  const databaseUrl = process.env.DATABASE_URL;
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
    const refusal = uiCheckRefusal({ step, files, surfaces, checks });
    if (refusal) fail(refusal);
    console.log(`Every surface has passed: #${step} may close.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
