/**
 * Every table with a page resolves a ref to a real row (plan #1449,
 * docs/CORE-AND-DASH-SPEC.md Part 1). For each entry in the registry this
 * writes one row, resolves `schema.table:id` through refTitles to its title
 * and page, and resolves a ref to a row that does not exist to "no longer
 * there". It also checks core.ref_owned says the row is its owner's and no one
 * else's, which is what lets a thread sit under it (plan #1468, Part 2). Each
 * row is written inside a transaction that is rolled back.
 *
 * The row is filled in generically: every column that must be set and has no
 * default gets a value of its type, the first value its check allows when
 * the check is a list, and the first label of its enum. Foreign keys and
 * triggers are switched off for the transaction, so the row needs no parents.
 * FILL below holds what that cannot work out for a table.
 */
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { NO_LONGER_THERE, pageColumns, refTitles, toRef, type ReadRows } from '@/lib/core/refs';
import { PAGES } from '@/lib/sources/catalogue';
import { sql } from './helpers/db';

afterAll(async () => {
  await sql.end();
});

const TITLE = 'A title to find';

/**
 * Values a table needs beyond the generic fill, for a check that is not a
 * list or so its page has what it reads: a conversation asked from anywhere,
 * a goal rather than a step. Given the row's user and id.
 */
const FILL: Record<string, (user: string, id: string) => Record<string, unknown>> = {
  'core.conversations': (_, id) => ({ subject_kind: 'ask', subject_ref: id }),
  'core.year_reviews': () => ({ year: 2025, totals: '{}' }),
  'core.week_reviews': () => ({ week: '2026-09-27', facts: '{}', source: 'plain' }),
  'goals.items': () => ({ level: 'goal', area_id: randomUUID(), parent_id: null, kind: null }),
  'job_search.companies': () => ({ slug: 'a-company' }),
  'learn.personality_results': () => ({ kind: 'mbti', typed_value: 'INTJ' }),
  'learn.watch_list': () => ({ video_id: 'dQw4w9WgXcQ' }),
  'news.issues': () => ({ text_body: 'x' }),
  'obsidian.notes': () => ({ path: 'Career/A note.md' }),
  'obsidian.transcripts': (user) => ({ storage_path: `${user}/a.pdf` }),
  'public.plan_items': () => ({ number: 4242 }),
  'public.social_posts': () => ({ body: '["x"]', draft: '["x"]' }),
  'todo.events': () => ({ starts_on: '2026-01-01', ends_on: '2026-01-02', starts_at: null, ends_at: null }),
  'todo.feed_events': () => ({ starts_on: '2026-01-01', ends_on: '2026-01-02', starts_at: null, ends_at: null }),
};

type Column = {
  name: string;
  type: string;
  udt: string;
  /** The column's type as SQL writes it, to cast a value to. */
  sqlType: string;
  nullable: boolean;
  hasDefault: boolean;
  identity: boolean;
};

async function columnsOf(tx: postgres.TransactionSql, table: string): Promise<Column[]> {
  const [schema, name] = table.split('.');
  return tx<Column[]>`
    select column_name as name, data_type as type, udt_schema || '.' || udt_name as udt,
           format_type(a.atttypid, a.atttypmod) as "sqlType",
           is_nullable = 'YES' as nullable, column_default is not null as "hasDefault",
           (is_identity = 'YES' or is_generated = 'ALWAYS') as identity
    from information_schema.columns c
    join pg_attribute a on a.attrelid = ${table}::regclass and a.attname = c.column_name
    where table_schema = ${schema} and table_name = ${name}
    order by ordinal_position`;
}

/** The values a check of the form `col = ANY (ARRAY['a', 'b'])` or `col IN (...)` allows. */
async function checkValues(tx: postgres.TransactionSql, table: string): Promise<Map<string, string>> {
  const rows = await tx<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = ${table}::regclass and contype = 'c'`;
  const out = new Map<string, string>();
  for (const { def } of rows) {
    const match = /\(+\s*"?([a-z_]+)"?\s*(?:::text)?\s*=\s*ANY\s*\(+ARRAY\[\s*'([^']*)'/i.exec(def);
    if (match && !out.has(match[1])) out.set(match[1], match[2]);
  }
  return out;
}

async function enumLabel(tx: postgres.TransactionSql, udt: string): Promise<string | null> {
  const [row] = await tx<{ label: string }[]>`
    select enumlabel as label from pg_enum where enumtypid = ${udt}::regtype order by enumsortorder limit 1`;
  return row?.label ?? null;
}

async function valueFor(tx: postgres.TransactionSql, column: Column, checks: Map<string, string>): Promise<unknown> {
  if (checks.has(column.name)) return checks.get(column.name);
  if (column.type === 'USER-DEFINED') return enumLabel(tx, column.udt);
  if (column.type === 'ARRAY') return '{}';
  switch (column.type) {
    case 'uuid':
      return randomUUID();
    case 'integer':
    case 'smallint':
    case 'bigint':
    case 'numeric':
    case 'double precision':
    case 'real':
      return 1;
    case 'boolean':
      return false;
    case 'date':
      return '2026-01-01';
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return '2026-01-01T00:00:00Z';
    case 'jsonb':
    case 'json':
      return '{}';
    default:
      return 'x';
  }
}

/**
 * Writes one row of `table` with `title` in its title column, and returns its
 * id and the account it belongs to: its user_id, or, for a table keyed by the
 * account itself, its id.
 */
async function writeRow(
  tx: postgres.TransactionSql,
  table: string,
  titleColumn: string | null,
): Promise<{ id: string; owner: string }> {
  const user = randomUUID();
  const id = randomUUID();
  const columns = await columnsOf(tx, table);
  const checks = await checkValues(tx, table);
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.identity) continue;
    if (column.name === 'user_id') values.user_id = user;
    else if (!column.nullable && !column.hasDefault) values[column.name] = await valueFor(tx, column, checks);
  }
  if (titleColumn) values[titleColumn] = TITLE;
  values.id = id;
  Object.assign(values, FILL[table]?.(user, id) ?? {});

  // Every value goes in as text and is cast to its column's type, so jsonb
  // and arrays arrive as what they spell rather than as a json string.
  const types = new Map(columns.map((c) => [c.name, c.sqlType]));
  const names = Object.keys(values);
  const [row] = await tx.unsafe<{ id: string }[]>(
    `insert into ${table} (${names.map((n) => `"${n}"`).join(', ')})
     values (${names.map((n, i) => `$${i + 1}::text::${types.get(n)}`).join(', ')}) returning id::text as id`,
    names.map((n) => (values[n] === null ? null : String(values[n]))),
  );
  return { id: row.id, owner: 'user_id' in values ? user : row.id };
}

function readerIn(tx: postgres.TransactionSql): ReadRows {
  return async (table, columns, ids) =>
    tx.unsafe(
      `select ${columns.map((c) => `"${c}"`).join(', ')}, id::text as id from ${table} where id::text = any($1::text[])`,
      [ids as string[]],
    );
}

class Rollback extends Error {}

/** Runs `fn` in a transaction with foreign keys and triggers off, then rolls it back. */
async function inRolledBack<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await sql
    .begin(async (tx) => {
      await tx.unsafe('set local session_replication_role = replica');
      result = await fn(tx);
      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return result as T;
}

describe('refs against the database', () => {
  it('has a page for a table of every kind the brief names', () => {
    const tables = PAGES.map((p) => p.table);
    expect(tables).toEqual(expect.arrayContaining(['public.orders', 'public.plan_items', 'goals.items']));
  });

  it.each(PAGES.map((entry) => [entry.table, entry] as const))(
    '%s resolves a real ref to its page and title, and a missing one to no longer there',
    async (table, { page }) => {
      const titleColumn = typeof page.title === 'string' ? page.title : null;
      await inRolledBack(async (tx) => {
        // The columns the entry reads exist, and its rows are named by a uuid id.
        const columns = await columnsOf(tx, table);
        const named = new Set(columns.map((c) => c.name));
        expect(pageColumns(page).filter((c) => !named.has(c)), table).toEqual([]);
        expect(columns.find((c) => c.name === 'id')?.type, `${table}.id`).toBe('uuid');

        const { id, owner } = await writeRow(tx, table, titleColumn);
        const ref = toRef(table, id);

        // A thread can sit under it (plan #1468): the check a row thread's ref
        // passes on insert says it is the owner's, and nobody else's.
        const [owned] = await tx<{ mine: boolean; theirs: boolean }[]>`
          select core.ref_owned(${ref}, ${owner}::uuid) as mine,
                 core.ref_owned(${ref}, ${randomUUID()}::uuid) as theirs`;
        expect(owned, ref).toEqual({ mine: true, theirs: false });
        const gone = toRef(table, randomUUID());
        const resolved = await refTitles([ref, gone], readerIn(tx));

        const found = resolved.get(ref)!;
        expect(found.missing, ref).toBe(false);
        if (titleColumn) expect(found.title).toBe(TITLE);
        else expect(found.title.length).toBeGreaterThan(0);
        expect(found.href, ref).toMatch(/^\/[a-z]/);

        expect(resolved.get(gone)).toMatchObject({ missing: true, title: NO_LONGER_THERE, href: null });
      });
    },
  );
});
