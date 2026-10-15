/**
 * Every table Dash can list that hangs off another one it can list says so
 * (plan #2109.2).
 *
 * Dash's lookups name each row's parent from the catalogue's declaration
 * (Source.parent, or its page's parent; lib/ask/parents.ts). A table with a
 * foreign key to another listable table and no parent declared returns rows
 * that cannot say whose they are: a cover letter with no application. This
 * fails for such a table, and for a declared link that names no real foreign
 * key, which is what Dash's later has/lacks queries follow.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { LISTABLE } from '@/lib/ask/list-rows';
import { sourceParent } from '@/lib/sources/catalogue';
import { sql } from './helpers/db';

/**
 * Listable tables with a key to another that declare no parent, each with
 * why. A parent on a table with its own page also becomes its breadcrumb,
 * so a link that is not "belongs to" stays off.
 */
const NO_PARENT: Record<string, string> = {
  'learn.subjects': 'Its page sits in Subjects on its own; aim_id and theme_id say what it serves, not what it is part of.',
  'learn.essays': 'An essay is also a vault note (note_id), the same piece of writing rather than a part of it.',
  'obsidian.tensions': 'Joins two positions as equals; neither side is its parent.',
};

type Key = { child: string; parent: string; columns: string[] };

afterAll(async () => {
  await sql.end();
});

async function foreignKeys(): Promise<Key[]> {
  const rows = await sql<{ child: string; parent: string; columns: string[] }[]>`
    select cn.nspname || '.' || cc.relname as child,
           pn.nspname || '.' || pc.relname as parent,
           array(select a.attname::text from unnest(c.conkey) k
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) as columns
    from pg_constraint c
    join pg_class cc on cc.oid = c.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = c.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
    where c.contype = 'f'`;
  return rows;
}

describe('the parents Dash names', () => {
  it('declares a parent on every listable table with a key to another listable table', async () => {
    const listable = new Set(LISTABLE.map((s) => s.table));
    const keys = await foreignKeys();
    const missing = LISTABLE.filter((s) => !sourceParent(s.table) && !(s.table in NO_PARENT)).flatMap((s) => {
      const to = keys.filter((k) => k.child === s.table && k.parent !== s.table && listable.has(k.parent));
      return to.length === 0
        ? []
        : [
            `${s.table} has a key to ${[...new Set(to.map((k) => k.parent))].join(', ')} but declares no parent: ` +
              'give it parent: parentBy(...) in its sources.ts, or add it to NO_PARENT with the reason.',
          ];
    });
    expect(missing).toEqual([]);
  });

  it('follows only real foreign keys', async () => {
    const keys = await foreignKeys();
    const tables = new Set(keys.map((k) => k.child));
    const wrong = LISTABLE.flatMap((s) =>
      (sourceParent(s.table)?.links ?? [])
        .filter(() => tables.has(s.table))
        .filter((link) => !keys.some((k) => k.child === s.table && k.parent === link.table && k.columns.includes(link.column)))
        .map((link) => `${s.table}.${link.column} is declared to name ${link.table}, but no foreign key says so.`),
    );
    expect(wrong).toEqual([]);
  });

  it('keeps NO_PARENT to listable tables that have no parent', () => {
    const listable = new Set(LISTABLE.map((s) => s.table));
    const stale = Object.keys(NO_PARENT).filter((t) => !listable.has(t) || sourceParent(t));
    expect(stale).toEqual([]);
  });
});
