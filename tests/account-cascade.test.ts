/**
 * Deleting the account has to actually reach everything.
 *
 * `/api/account/delete` removes one row -- auth.users -- and trusts the
 * database to take the other fifty tables with it. That trust is only as good
 * as the last migration anybody wrote: a table added with
 * `references auth.users (id)` and no `on delete cascade` does not fail, it
 * quietly refuses the delete, and the first person to find out is somebody who
 * asked to leave and could not. So the rule is asserted here rather than left
 * to whoever reviews the next migration.
 *
 * Reading the migrations rather than the database is deliberate: this runs with
 * no Postgres at all, which is the only way it can run on every change.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SUPABASE = join(ROOT, 'supabase');

/** Every migration directory: one per schema this account's data lives in. */
function migrationFiles(): Array<{ path: string; sql: string }> {
  return readdirSync(SUPABASE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('migrations'))
    .flatMap((dir) =>
      readdirSync(join(SUPABASE, dir.name))
        .filter((name) => name.endsWith('.sql'))
        .map((name) => ({
          path: `supabase/${dir.name}/${name}`,
          sql: readFileSync(join(SUPABASE, dir.name, name), 'utf8'),
        })),
    );
}

/** `-- like this` is prose, and prose is allowed to say anything. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * Every column that points at a user, with the rest of its definition.
 *
 * A foreign key is written one of two ways in these migrations -- inline on the
 * column, or as a table constraint -- and both end at the comma or the closing
 * paren, so that is where the referential action has to have appeared by.
 */
function userReferences(sql: string): string[] {
  const found: string[] = [];
  const pattern = /references\s+auth\.users\s*\([^)]*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const rest = sql.slice(match.index + match[0].length);
    const end = rest.search(/[,)]/);
    found.push(match[0] + (end === -1 ? rest : rest.slice(0, end)));
  }
  return found;
}

describe('account deletion cascade', () => {
  const files = migrationFiles();

  it('reads the migrations of every schema', () => {
    const directories = new Set(files.map((file) => file.path.split('/')[1]));
    // public, job_search, obsidian, todo, learn.
    expect(directories.size).toBeGreaterThanOrEqual(5);
  });

  it('finds the user columns it is meant to be checking', () => {
    // A regex that matched nothing would pass the real assertion silently.
    const total = files.reduce(
      (count, file) => count + userReferences(withoutComments(file.sql)).length,
      0,
    );
    expect(total).toBeGreaterThan(30);
  });

  it('cascades from auth.users everywhere a row names a user', () => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const reference of userReferences(withoutComments(file.sql))) {
        if (!/on\s+delete\s+cascade/i.test(reference)) {
          offenders.push(`${file.path}: ${reference.replace(/\s+/g, ' ').trim()}`);
        }
      }
    }

    // Named rather than counted: the failure is only useful if it says which
    // table would survive the account that owns it.
    expect(offenders).toEqual([]);
  });
});
