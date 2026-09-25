/**
 * Every table the migrations create is either a source Goals may search or
 * listed as not one, with the reason (lib/sources/types.ts). This is what
 * keeps the catalogue current: a new table fails the gate here until the
 * session that made it decides which it is, in its module's sources.ts.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { AWAITING_MIGRATION, NOT_SOURCES, SOURCE_SCHEMAS, SOURCES } from '@/lib/sources/catalogue';
import { sql } from './helpers/db';

type Column = { table: string; column: string };

async function tables(): Promise<string[]> {
  const rows = await sql<{ t: string }[]>`
    select table_schema || '.' || table_name as t
    from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema in ${sql(SOURCE_SCHEMAS as string[])}
    order by 1`;
  return rows.map((r) => r.t);
}

async function columns(): Promise<Column[]> {
  return sql<Column[]>`
    select table_schema || '.' || table_name as table, column_name as column
    from information_schema.columns
    where table_schema in ${sql(SOURCE_SCHEMAS as string[])}`;
}

afterAll(async () => {
  await sql.end();
});

describe('the catalogue of sources against the database', () => {
  it('classifies every table', async () => {
    const declared = new Set([...SOURCES.map((s) => s.table), ...NOT_SOURCES.map((n) => n.table)]);
    const missing = (await tables()).filter((t) => !declared.has(t));
    // Each line names the fix, so a session that added a table knows what to do.
    expect(
      missing.map(
        (t) =>
          `${t} is new: declare it as a source in its module's sources.ts, or list it there as not a source with a reason (lib/sources/types.ts).`,
      ),
    ).toEqual([]);
  });

  it('declares only tables that exist', async () => {
    const present = new Set(await tables());
    const gone = [...SOURCES.map((s) => s.table), ...NOT_SOURCES.map((n) => n.table)].filter(
      (t) => !present.has(t) && !(t in AWAITING_MIGRATION),
    );
    expect(gone.map((t) => `${t} is in the catalogue but not in the database: remove or rename it.`)).toEqual([]);
  });

  it('searches, names and links rows by columns that exist', async () => {
    const present = new Set((await columns()).map((c) => `${c.table}.${c.column}`));
    const tablesPresent = new Set(await tables());
    const wrong: string[] = [];
    for (const s of SOURCES) {
      if (!tablesPresent.has(s.table)) continue;
      const named = [...s.search, s.title, s.ref ?? 'id'];
      if (s.owner && /^\w+$/.test(s.owner)) named.push(s.owner);
      if (!s.owner) named.push('user_id');
      for (const column of named) {
        if (!present.has(`${s.table}.${column}`)) wrong.push(`${s.table}.${column}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
