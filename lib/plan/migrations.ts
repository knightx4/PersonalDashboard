/**
 * Whether the migrations on main have been applied to the live database.
 *
 * CI cannot answer this. It builds a fresh database from the files, so a
 * migration that was merged and never applied passes every check while the
 * deployed app reads a column the live database does not have. CLAUDE.md
 * names this as the failure that has broken pages here more than once.
 *
 * The overnight tick (`lib/plan/ci.ts` `refreshMainCheck`) lists the files on
 * main from GitHub and the applied names from the live database, and this
 * file is the part that decides which files are missing. Pure, so it can be
 * tested against the real history without either side.
 *
 * -- How a file is matched --
 *
 * The live history does not record file names. It records whatever name the
 * session gave `apply_migration`, and those have been written three ways:
 * `learn_0026_catalogue_judgements` for `migrations-learn/0026_catalogue_judgements.sql`,
 * `plan_main_check_reason` for `migrations/0095_plan_main_check_reason.sql`,
 * and `learn_concept_subjects` for `migrations-learn/0020_concept_subjects.sql`.
 * All three end with the file's name, with or without its number, so that is
 * the rule: a file is applied when some live name is its name or ends with
 * `_` and its name, number or no number. It would miss a migration applied
 * under a name that says something else entirely, which is why CLAUDE.md asks
 * for the file's own name.
 *
 * -- What is not checked --
 *
 * Files at or below `VERIFIED_THROUGH` for their folder. Those were compared
 * against the live history by hand on 22 September 2026 and the few that
 * match no live name were applied before names were kept consistently, or
 * folded into another migration. Checking them would put a permanent false
 * alarm on every page. Everything after the line is held to the rule.
 */

/** One migration file on main. */
export type MigrationFile = {
  /** The folder under `supabase/`, e.g. `migrations-learn`. */
  dir: string;
  /** The file name, e.g. `0026_catalogue_judgements.sql`. */
  name: string;
};

/**
 * The newest migration number per folder that was checked by hand, and that
 * the automatic check therefore starts after. A folder not listed here is
 * checked from its first file, which is right for a folder created later.
 */
export const VERIFIED_THROUGH: Readonly<Record<string, number>> = {
  migrations: 95,
  'migrations-job-search': 25,
  'migrations-learn': 26,
  'migrations-news': 4,
  'migrations-todo': 9,
  'migrations-vault': 4,
};

/** The leading number of a migration file, or null for a file without one. */
function numberOf(name: string): number | null {
  const match = /^(\d+)_/.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * The newest file per folder that may be recorded under a loose name.
 *
 * The rule above, "ends with the file's name, number or no number", reads
 * across folders: a later `migrations-vault/0040_merge_ideas.sql` would have
 * counted as applied because `learn_0154_merge_ideas` ends with `_merge_ideas`,
 * and the workflow on main would never have applied it. Files after this
 * line must be recorded under a name that belongs to their own folder:
 * `liveMigrationName`, or for the core folder the name without its number,
 * which is what CLAUDE.md asks for and what scripts/apply-migrations.ts
 * writes. Files at or below it keep the loose rule, because some were
 * applied under a bare name with no folder (`message_role_hint` for
 * migrations-job-search/0044) and holding them to the strict rule would have
 * the workflow apply them a second time.
 */
export const LOOSE_NAMES_THROUGH: Readonly<Record<string, number>> = {
  migrations: 251,
  'migrations-goals': 78,
  'migrations-job-search': 57,
  'migrations-learn': 164,
  'migrations-news': 20,
  'migrations-todo': 17,
  'migrations-vault': 36,
  'migrations-you': 7,
};

/** The names a file may be recorded under once the loose rule no longer covers it. */
function ownNames(file: MigrationFile): string[] {
  const stem = file.name.replace(/\.sql$/, '');
  const bare = stem.replace(/^\d+_/, '');
  const own = liveMigrationName(`${file.dir}/${file.name}`);
  if (file.dir === 'migrations') return [stem, bare];
  return [own, own.replace(stem, bare)];
}

/** Whether a live history name records this file. */
export function migrationApplied(file: MigrationFile, applied: ReadonlySet<string>): boolean {
  const n = numberOf(file.name);
  const line = LOOSE_NAMES_THROUGH[file.dir];
  if (line === undefined || n === null || n > line) {
    return ownNames(file).some((name) => applied.has(name));
  }
  const stem = file.name.replace(/\.sql$/, '');
  const bare = stem.replace(/^\d+_/, '');
  if (applied.has(stem) || applied.has(bare)) return true;
  for (const name of applied) {
    if (name.endsWith(`_${stem}`) || name.endsWith(`_${bare}`)) return true;
  }
  return false;
}

/**
 * The files on main past the verified line that no live name records, as
 * `folder/file` paths in folder and file order.
 */
export function unappliedMigrations(
  files: readonly MigrationFile[],
  applied: ReadonlySet<string>,
): string[] {
  return files
    .filter((file) => file.name.endsWith('.sql'))
    .filter((file) => {
      const n = numberOf(file.name);
      const line = VERIFIED_THROUGH[file.dir];
      return line === undefined || n === null || n > line;
    })
    .filter((file) => !migrationApplied(file, applied))
    .map((file) => `${file.dir}/${file.name}`)
    .sort();
}

/**
 * The sentence the panel shows, or null when nothing is missing.
 *
 * Names up to three files, because the point is to say which ones to apply,
 * and the count carries the rest.
 */
export function unappliedSentence(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const named = paths.slice(0, 3).join(', ');
  const more = paths.length > 3 ? ` and ${paths.length - 3} more` : '';
  const noun = paths.length === 1 ? 'migration is' : 'migrations are';
  return `${paths.length} ${noun} on main but not applied to the live database: ${named}${more}.`;
}

/**
 * The name a file is applied under: the file's own name, with its folder in
 * front for every folder but `migrations`. `migrations-learn/0154_merge_ideas.sql`
 * goes in as `learn_0154_merge_ideas`, the shape CLAUDE.md asks sessions for
 * and `migrationApplied` reads back.
 */
export function liveMigrationName(path: string): string {
  const [dir, file] = path.split('/');
  const stem = file.replace(/\.sql$/, '');
  if (dir === 'migrations') return stem;
  return `${dir.replace(/^migrations-/, '').replace(/-/g, '_')}_${stem}`;
}

/**
 * The order to apply `folder/file` paths in: the core folder first, because
 * the modules' tables refer to its tables and never the other way, then each
 * module folder by name, and by file name within a folder.
 */
export function applyOrder(paths: readonly string[]): string[] {
  const core = (path: string) => (path.startsWith('migrations/') ? 0 : 1);
  return [...paths].sort((a, b) => core(a) - core(b) || a.localeCompare(b));
}

/**
 * Statements a rehearsal cannot run: they end the transaction it rolls back
 * (so the file's changes would stay), or Postgres refuses them inside one.
 * Read with comments and dollar-quoted bodies taken out, so a function's own
 * `begin ... end` does not count.
 */
const NOT_IN_A_TRANSACTION =
  /(^|;)\s*(begin|commit|rollback|end|start\s+transaction|savepoint|release|vacuum|alter\s+system|create\s+database|drop\s+database)\b|\bconcurrently\b/i;

function withoutBodies(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Why a file cannot be rehearsed, or null when it can. */
export function cannotRehearse(sql: string): string | null {
  const match = NOT_IN_A_TRANSACTION.exec(withoutBodies(sql));
  if (!match) return null;
  return `it runs \`${match[0].replace(/^[;\s]+/, '').trim().toLowerCase()}\`, which cannot run inside the transaction a rehearsal rolls back`;
}

/**
 * The script that runs files against the live database and keeps nothing.
 *
 * One transaction, rolled back at the end, so every statement runs against
 * the real rows and none of it stays. The timeouts keep a rehearsal from
 * holding a lock the app is waiting on: a migration that needs longer than
 * that on live data is worth knowing about before main applies it.
 */
export function rehearsalScript(files: ReadonlyArray<{ path: string; sql: string }>): string {
  const body = files.map((file) => `-- ${file.path}\n${file.sql.trim()}\n`).join('\n');
  return [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '120s';",
    body,
    'rollback;',
  ].join('\n');
}
