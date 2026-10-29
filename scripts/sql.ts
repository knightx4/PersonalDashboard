/**
 * Run one SQL statement against the live database and print the rows as JSON.
 *
 *   npm run sql -- "select id, title from goals.goals where user_id = '…'"
 *   npm run sql -- --file path/to/statement.sql
 *   echo "update …" | npm run sql
 *   npm run sql -- --set goals.actor=claude --set goals.run_id=<id> "insert … returning id"
 *
 * This is how a routine reads and makes ordinary writes, instead of the
 * Supabase connector. The connector holds some statements for a
 * confirmation that never reaches a cloud session: the call waits 60
 * seconds, times out without running, and the person's phone gets a
 * "Claude needs your input" notification with nothing to answer.
 *
 * Connects the way scripts/plan.ts does: in a cloud session, over HTTPS
 * through public.service_sql (migration 0241) with SUPABASE_SERVICE_ROLE_KEY;
 * elsewhere, DATABASE_URL. One statement per call, committed on its own.
 * Each `--set name=value` is made with set_config in that statement's own
 * transaction first, the way `set local` works through the connector.
 *
 * What it takes is narrower than the connector, on purpose
 * (lib/db/sql-guard.ts): a select, or an insert or update that names the
 * owner's user id. A delete, truncate or schema change is refused.
 *
 * Write `:owner` where the statement means the owner's id; it is read from
 * the database (core.app_settings) and put in before the check:
 *
 *   npm run sql -- "select id, title from goals.goals where user_id = :owner"
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { httpsSql, restTransport } from '../lib/db/https-sql';
import { OWNER_QUERY, sqlRefusal, withOwner } from '../lib/db/sql-guard';
import { requireSupabaseProjectUrl } from '../lib/db/project';

type Settings = Record<string, string>;

async function run(statement: string, settings: Settings): Promise<unknown[]> {
  const url = process.env.DATABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const named = Object.keys(settings).length > 0;
  // A cloud session's proxy carries HTTPS and not Postgres.
  if (key && (process.env.CLAUDE_CODE_REMOTE === 'true' || !url)) {
    const rest = requireSupabaseProjectUrl();
    return httpsSql(restTransport(rest, key, named ? settings : undefined)).unsafe(statement);
  }
  if (!url) {
    console.error('Neither DATABASE_URL nor SUPABASE_SERVICE_ROLE_KEY is set. One is needed to run SQL.');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      for (const [name, value] of Object.entries(settings)) {
        await tx`select set_config(${name}, ${value}, true)`;
      }
      return tx.unsafe(statement);
    });
  } finally {
    await sql.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const settings: Settings = {};
  const rest: string[] = [];
  let file: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[++i];
    else if (args[i] === '--set') {
      const [name, ...value] = (args[++i] ?? '').split('=');
      if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(name) || value.length === 0) {
        console.error(`--set takes a custom setting as name=value, such as goals.actor=claude; not ${args[i]}`);
        process.exit(1);
      }
      settings[name] = value.join('=');
    } else rest.push(args[i]);
  }
  let statement: string;
  if (file) statement = readFileSync(file, 'utf8');
  else if (rest.length > 0) statement = rest.join(' ');
  else statement = readFileSync(0, 'utf8');
  statement = statement.trim().replace(/;\s*$/, '');

  if (!statement) {
    console.error('No statement given. Pass it as an argument, with --file, or on stdin.');
    process.exit(1);
  }
  // A plain read needs no owner; anything that names one, or writes, reads it first.
  if (/:owner\b/.test(statement) || sqlRefusal(statement, null)) {
    const [row] = (await run(OWNER_QUERY, {})) as Array<{ id?: string | null }>;
    const owner = row?.id ?? null;
    if (owner) statement = withOwner(statement, owner);
    const refused = sqlRefusal(statement, owner);
    if (refused) {
      console.error(refused);
      process.exit(1);
    }
  }

  try {
    console.log(JSON.stringify(await run(statement, settings), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
