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

/** Whether a live history name records this file. */
export function migrationApplied(file: MigrationFile, applied: ReadonlySet<string>): boolean {
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
