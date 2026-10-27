/**
 * Applies the migrations on this checkout that the live database has not had.
 *
 *   npx tsx scripts/apply-migrations.ts            # apply what is missing
 *   npx tsx scripts/apply-migrations.ts --dry-run  # only say what is missing
 *   npx tsx scripts/apply-migrations.ts --rehearse # run what is missing, then roll it back
 *
 * Run by .github/workflows/migrations.yml on every push to main. It goes
 * through the Supabase Management API with a personal access token, because
 * the Supabase connector holds any statement containing a delete for the
 * person to confirm, and a session working alone cannot answer that prompt.
 *
 * Which files are missing is decided by `unappliedMigrations`, the rule the
 * status line's CI panel uses, so the two cannot disagree. Each file goes in
 * under `liveMigrationName`, the name that rule reads back. The first failure
 * stops the run: the files after it may depend on it.
 *
 * Without SUPABASE_ACCESS_TOKEN it says so and exits cleanly, so main does not
 * go red before the secret is set.
 *
 * --rehearse is for a branch, before it reaches main. It runs the missing
 * files against the live database in one transaction that it rolls back
 * (`rehearsalScript`), so a migration that passes on the empty test database
 * and fails on the real rows turns the branch red rather than main. When the
 * run fails it is repeated one file longer each time, to name the file that
 * broke. A file that cannot run inside a transaction (`cannotRehearse`) stops
 * the rehearsal at that file with a warning, since the ones after may need it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyOrder,
  cannotRehearse,
  liveMigrationName,
  rehearsalScript,
  unappliedMigrations,
  type MigrationFile,
} from '../lib/plan/migrations';
import { supabaseProjectRef } from '../lib/db/project';

const MANAGEMENT = 'https://api.supabase.com/v1/projects';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const dryRun = process.argv.includes('--dry-run');
const rehearse = process.argv.includes('--rehearse');

if (!token) {
  console.log(
    '::notice::SUPABASE_ACCESS_TOKEN is not set, so no migrations were applied. ' +
      'Add it under the repository Settings → Secrets and variables → Actions.',
  );
  process.exit(0);
}

/**
 * The project to apply to, named in the environment (lib/db/project.ts) or,
 * when nothing names it, the one project the access token can see. A token
 * that sees several needs SUPABASE_PROJECT_REF set to choose between them.
 */
async function projectRef(): Promise<string> {
  const named = supabaseProjectRef();
  if (named) return named;
  const projects = (await api('GET', undefined, MANAGEMENT)) as Array<{
    id?: string;
    ref?: string;
  }>;
  const refs = projects
    .map((project) => project.ref ?? project.id)
    .filter((ref): ref is string => !!ref);
  if (refs.length === 1) return refs[0];
  throw new Error(
    `The access token sees ${refs.length} projects. Set SUPABASE_PROJECT_REF to the one this app uses.`,
  );
}

let API = '';
let QUERY_API = '';

async function api(method: 'GET' | 'POST', body?: unknown, url = API): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${res.status}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : null;
}

async function main(): Promise<number> {
  const ref = await projectRef();
  API = `${MANAGEMENT}/${ref}/database/migrations`;
  QUERY_API = `${MANAGEMENT}/${ref}/database/query`;
  const root = join(process.cwd(), 'supabase');
  const files: MigrationFile[] = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('migrations'))
    .flatMap((dir) =>
      readdirSync(join(root, dir.name)).map((name) => ({ dir: dir.name, name })),
    );

  const history = (await api('GET')) as Array<{ name?: string | null }>;
  const applied = new Set(history.map((row) => row.name ?? '').filter(Boolean));
  const missing = applyOrder(unappliedMigrations(files, applied));

  if (missing.length === 0) {
    console.log('The live database has every migration on this commit.');
    return 0;
  }
  console.log(`${missing.length} to apply: ${missing.join(', ')}`);
  if (dryRun) return 0;
  if (rehearse) return rehearseFiles(root, missing);

  for (const path of missing) {
    const name = liveMigrationName(path);
    const query = readFileSync(join(root, path), 'utf8');
    try {
      await api('POST', { query, name });
      console.log(`Applied ${path} as ${name}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`::error title=Migration ${path} failed::${message.replace(/\n/g, ' ')}`);
      const rest = missing.slice(missing.indexOf(path) + 1);
      if (rest.length > 0) console.log(`Not attempted after it: ${rest.join(', ')}`);
      return 1;
    }
  }
  return 0;
}

async function runRolledBack(files: Array<{ path: string; sql: string }>): Promise<string | null> {
  try {
    await api('POST', { query: rehearsalScript(files) }, QUERY_API);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function rehearseFiles(root: string, missing: string[]): Promise<number> {
  const files: Array<{ path: string; sql: string }> = [];
  for (const path of missing) {
    const sql = readFileSync(join(root, path), 'utf8');
    const reason = cannotRehearse(sql);
    if (reason) {
      console.log(`::warning title=Migration ${path} not rehearsed::${reason}. It and the files after it are applied on main unrehearsed.`);
      break;
    }
    files.push({ path, sql });
  }
  if (files.length === 0) return 0;

  const failure = await runRolledBack(files);
  if (!failure) {
    console.log(`Rehearsed against the live database and rolled back: ${files.map((f) => f.path).join(', ')}.`);
    return 0;
  }
  // Longer and longer runs until one fails, so the error names its file.
  for (let i = 1; i <= files.length; i += 1) {
    const error = i === files.length ? failure : await runRolledBack(files.slice(0, i));
    if (error) {
      const path = files[i - 1].path;
      console.log(`::error title=Migration ${path} fails on the live database::${error.replace(/\n/g, ' ')}`);
      return 1;
    }
  }
  console.log(`::error title=Migrations fail on the live database::${failure.replace(/\n/g, ' ')}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.log(`::error title=Migrations not applied::${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
