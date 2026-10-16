/**
 * Applies the migrations on this checkout that the live database has not had.
 *
 *   npx tsx scripts/apply-migrations.ts            # apply what is missing
 *   npx tsx scripts/apply-migrations.ts --dry-run  # only say what is missing
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
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyOrder,
  liveMigrationName,
  unappliedMigrations,
  type MigrationFile,
} from '../lib/plan/migrations';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'asjztutnqxbecruvyrbj';
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/migrations`;

const token = process.env.SUPABASE_ACCESS_TOKEN;
const dryRun = process.argv.includes('--dry-run');

if (!token) {
  console.log(
    '::notice::SUPABASE_ACCESS_TOKEN is not set, so no migrations were applied. ' +
      'Add it under the repository Settings → Secrets and variables → Actions.',
  );
  process.exit(0);
}

async function api(method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const res = await fetch(API, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${res.status}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : null;
}

async function main(): Promise<number> {
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

main().then(
  (code) => process.exit(code),
  (err) => {
    console.log(`::error title=Migrations not applied::${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
