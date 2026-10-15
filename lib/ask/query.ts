import type { Source } from '@/lib/sources/types';
import { AskInputError, clip, matchedNote, optionalString, type AskContext, type AskRow, type AskSchema, type AskToolResult } from './db';
import { asText, fallbackHref, listableSource, ownerColumn, sourceWorkspace, viaTitle } from './list-rows';
import { listableShapes, type TableColumn } from './table-info';

/**
 * query_rows: the person's rows in one table that meet a list of conditions
 * (plan #2109.4). It lists them, counts them, or counts them by the values of
 * one column, so "how many applications at each status" or "which
 * applications have no cover letter mark" is one call, not a list_rows read
 * and a count made by eye.
 *
 * Read only, like every lookup. The tables are the ones list_rows reads, and
 * every column named, in a condition, the columns asked for, the order or the
 * grouping, is checked against the table's real columns (listableShapes,
 * lib/ask/table-info.ts) before anything is sent. The query is built with the
 * supabase-js filter methods, never from SQL text, and always carries the
 * owner filter as well as row level security.
 *
 * A condition is parsed into a `Condition`, a union with one kind today:
 * `column`. Plan #2109.5 adds a kind for rows with or without linked rows in
 * another table, applied in `applyCondition` beside it.
 */

/** The most rows listed by one call. */
export const QUERY_ROWS_MAX = 200;
const QUERY_ROWS_DEFAULT = 50;
/** Grouping reads the grouped column this many rows to a page, and no more than GROUP_ROWS in all. */
const GROUP_PAGE = 1000;
const GROUP_ROWS = 20000;
/** Characters kept of each column, for each row. open_row reads one row in full. */
const COLUMN_CHARS = 400;
/** The most values one_of takes. */
const ONE_OF_MAX = 100;

export const QUERY_OPS = ['equals', 'not_equals', 'greater', 'less', 'one_of', 'contains', 'empty', 'not_empty'] as const;
export type QueryOp = (typeof QUERY_OPS)[number];

type Scalar = string | number | boolean;

/** One condition a row must meet. */
export type Condition = {
  kind: 'column';
  column: string;
  op: QueryOp;
  /** A scalar for equals, not_equals, greater, less and contains; a list for one_of; absent for empty and not_empty. */
  value: Scalar | Scalar[] | null;
  type: string;
};

/** How a column's type is treated: as text, as a list, or as anything else. */
function typeKind(type: string): 'text' | 'array' | 'other' {
  if (type.endsWith('[]')) return 'array';
  if (/^(text|character varying|character|citext)\b/.test(type)) return 'text';
  return 'other';
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';
}

/** A value inside a PostgREST or-filter, quoted so commas, dots and brackets stay part of it. */
function quoted(value: Scalar): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** % and _ as themselves in an ilike pattern. */
function likeEscaped(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function columnOf(columns: Map<string, TableColumn>, table: string, name: unknown, what: string): TableColumn {
  if (typeof name !== 'string' || !name.trim()) throw new AskInputError(`${what} must name a column.`);
  const column = columns.get(name.trim());
  if (!column) {
    throw new AskInputError(`${table} has no column ${name.trim()}. Its columns: ${[...columns.keys()].join(', ')}.`);
  }
  return column;
}

/** The conditions as given, checked against the table's columns. */
export function parseConditions(raw: unknown, table: string, columns: Map<string, TableColumn>): Condition[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AskInputError('where must be a list of conditions.');
  return raw.map((item, i): Condition => {
    if (!item || typeof item !== 'object') throw new AskInputError(`Condition ${i + 1} must be an object.`);
    const c = item as Record<string, unknown>;
    const column = columnOf(columns, table, c.column, `Condition ${i + 1}`);
    const op = c.op as QueryOp;
    if (!QUERY_OPS.includes(op)) throw new AskInputError(`Condition ${i + 1} needs op, one of ${QUERY_OPS.join(', ')}.`);
    const base = { kind: 'column' as const, column: column.column, op, type: column.type };
    if (op === 'empty' || op === 'not_empty') return { ...base, value: null };
    if (op === 'one_of') {
      const values = c.value;
      if (!Array.isArray(values) || values.length === 0 || values.length > ONE_OF_MAX || !values.every(isScalar)) {
        throw new AskInputError(`Condition ${i + 1} (one_of) needs value as a list of 1 to ${ONE_OF_MAX} values.`);
      }
      return { ...base, value: values };
    }
    if (!isScalar(c.value)) {
      throw new AskInputError(`Condition ${i + 1} (${op}) needs a value. For a column with nothing in it, use empty.`);
    }
    if (op === 'contains' && typeKind(column.type) === 'other') {
      throw new AskInputError(`contains works on text and list columns; ${column.column} is ${column.type}. Use equals or one_of.`);
    }
    return { ...base, value: c.value };
  });
}

/**
 * The supabase-js filter methods a condition uses. Typed loosely, since the
 * builder's own types follow a schema this code does not have.
 */
type Filterable<Q> = {
  eq(column: string, value: unknown): Q;
  neq(column: string, value: unknown): Q;
  gt(column: string, value: unknown): Q;
  lt(column: string, value: unknown): Q;
  in(column: string, values: readonly unknown[]): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: unknown): Q;
  ilike(column: string, pattern: string): Q;
  contains(column: string, value: unknown): Q;
  or(filters: string): Q;
};

export function applyCondition<Q extends Filterable<Q>>(query: Q, c: Condition): Q {
  const kind = typeKind(c.type);
  const col = c.column;
  switch (c.op) {
    case 'equals':
      return query.eq(col, c.value);
    case 'not_equals':
      // A row with nothing in the column is not equal to the value either;
      // SQL's <> alone would leave it out.
      return query.or(`${col}.is.null,${col}.neq.${quoted(c.value as Scalar)}`);
    case 'greater':
      return query.gt(col, c.value);
    case 'less':
      return query.lt(col, c.value);
    case 'one_of':
      return query.in(col, c.value as Scalar[]);
    case 'contains':
      return kind === 'array' ? query.contains(col, [c.value]) : query.ilike(col, `%${likeEscaped(String(c.value))}%`);
    case 'empty':
      if (kind === 'text') return query.or(`${col}.is.null,${col}.eq.""`);
      if (kind === 'array') return query.or(`${col}.is.null,${col}.eq.{}`);
      return query.is(col, null);
    case 'not_empty': {
      const set = query.not(col, 'is', null);
      if (kind === 'text') return set.neq(col, '');
      if (kind === 'array') return set.neq(col, '{}');
      return set;
    }
  }
}

function limitOf(input: Record<string, unknown>): number {
  const raw = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.floor(input.limit) : QUERY_ROWS_DEFAULT;
  return Math.min(Math.max(raw, 1), QUERY_ROWS_MAX);
}

/** How a grouped value is keyed and shown: null stays null, anything not text as JSON. */
function groupValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (isScalar(value)) return value;
  return JSON.stringify(value);
}

function describe(conditions: Condition[]): string {
  if (conditions.length === 0) return 'all their rows';
  const words: Record<QueryOp, string> = {
    equals: '=',
    not_equals: '≠',
    greater: '>',
    less: '<',
    one_of: 'one of',
    contains: 'contains',
    empty: 'is empty',
    not_empty: 'is not empty',
  };
  return `rows where ${conditions
    .map((c) => [c.column, words[c.op], c.value === null ? null : JSON.stringify(c.value)].filter(Boolean).join(' '))
    .join(' and ')}`;
}

export async function queryRowsLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const table = optionalString(input, 'table');
  if (!table) throw new AskInputError('Give the table to query.');
  const source = listableSource(table);
  if (!source) throw new AskInputError(`${table} is not a table Dash can read. table_info lists them.`);
  const workspace = sourceWorkspace(source);
  if (workspace && !ctx.enabledModules.includes(workspace)) {
    throw new AskInputError(`${table} is in a workspace that is switched off, so it cannot be read.`);
  }

  const shape = (await listableShapes(ctx)).get(table);
  const columns = new Map((shape?.columns ?? []).map((c) => [c.column, c]));
  if (columns.size === 0) throw new Error(`${table}: no columns came back from ask_table_columns`);

  const conditions = parseConditions(input.where, table, columns);
  const groupBy = input.group_by === undefined || input.group_by === null ? null : columnOf(columns, table, input.group_by, 'group_by');
  const countOnly = input.count_only === true;
  if (groupBy && countOnly) throw new AskInputError('Give group_by or count_only, not both: group_by already counts.');

  const [schema, name] = table.split('.') as [AskSchema, string];
  const owner = ownerColumn(source) as string;
  const client = await ctx.db(schema);
  const scoped = (select: string, options?: { count: 'exact'; head?: boolean }) => {
    let query = client.from(name).select(select, options).eq(owner, ctx.userId);
    for (const c of conditions) query = applyCondition(query, c);
    return query;
  };
  const what = describe(conditions);

  if (countOnly) {
    const { count, error } = await scoped(owner, { count: 'exact', head: true });
    if (error) throw new AskInputError(`${table} refused the query: ${error.message}`);
    const matched = count ?? 0;
    return {
      ok: true,
      rows: [],
      totals: { matched, shown: 0 },
      note: `Counted ${what} in ${table}: ${matched} matched, listing none (count_only).`,
    };
  }

  if (groupBy) {
    // Pages are cut from one order, so the tie-break has to be unique or a
    // row could fall between two pages.
    const unique = source.ref ?? (columns.has('id') ? 'id' : owner);
    return groupedCount(table, groupBy.column, what, (from, count) =>
      scoped(groupBy.column, count ? { count: 'exact' } : undefined)
        .order(groupBy.column)
        .order(unique)
        .range(from, from + GROUP_PAGE - 1),
    );
  }

  return listed(table, source, columns, input, what, (select, order, ascending, limit) =>
    scoped(select, { count: 'exact' }).order(order, { ascending, nullsFirst: false }).range(0, limit - 1),
  );
}

type Page = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>;

/** The rows counted by the values of one column, most common first, read a page at a time. */
async function groupedCount(
  table: string,
  column: string,
  what: string,
  page: (from: number, count: boolean) => Page,
): Promise<AskToolResult> {
  const counts = new Map<string, { value: string | number | boolean | null; count: number }>();
  let read = 0;
  let total = 0;
  for (;;) {
    const result = await page(read, read === 0);
    if (result.error) throw new AskInputError(`${table} refused the query: ${result.error.message}`);
    const rows = (result.data ?? []) as Record<string, unknown>[];
    if (read === 0) total = Math.max(result.count ?? rows.length, rows.length);
    for (const row of rows) {
      const value = groupValue(row[column]);
      const key = JSON.stringify(value);
      const entry = counts.get(key) ?? { value, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    read += rows.length;
    if (rows.length === 0 || read >= total || read >= GROUP_ROWS) break;
  }
  const groups = [...counts.values()].sort((a, b) => b.count - a.count);
  const partial = read < total;
  const counted = partial ? `, counting the first ${read} into groups` : '';
  return {
    ok: true,
    rows: [],
    totals: { matched: total, shown: 0, group_by: column, groups },
    note: `Counted ${what} in ${table} by ${column}: ${total} matched${counted}, in ${groups.length} groups; listing none. A null value is the group of rows with nothing in ${column}.`,
  };
}

/** The rows that match, in the order asked, up to the limit, with the number that matched. */
async function listed(
  table: string,
  source: Source,
  columns: Map<string, TableColumn>,
  input: Record<string, unknown>,
  what: string,
  page: (select: string, order: string, ascending: boolean, limit: number) => Page,
): Promise<AskToolResult> {
  const limit = limitOf(input);
  const refColumn = source.ref ?? 'id';

  let asked: string[];
  if (input.columns === undefined || input.columns === null) {
    asked = [...source.search, ...(source.facts ?? [])].filter((c) => columns.has(c));
  } else {
    if (!Array.isArray(input.columns)) throw new AskInputError('columns must be a list of column names.');
    asked = input.columns.map((c) => columnOf(columns, table, c, 'Each of columns').column);
  }

  const orderIn = input.order && typeof input.order === 'object' ? (input.order as Record<string, unknown>) : null;
  const orderColumn = orderIn ? columnOf(columns, table, orderIn.column, 'order').column : (source.newest ?? 'created_at');
  const ascending = orderIn?.ascending === true;

  const plain = [...new Set([refColumn, ...(columns.has('id') ? ['id'] : []), source.title, ...asked])];
  const select = source.titleVia ? [...plain, `${source.titleVia.embed}(${source.titleVia.column})`] : plain;

  const { data, error, count } = await page(select.join(', '), orderColumn, ascending, limit);
  if (error) throw new AskInputError(`${table} refused the query: ${error.message}`);
  const found = (data ?? []) as unknown as Record<string, unknown>[];
  const matched = Math.max(count ?? found.length, found.length);

  const rows: AskRow[] = found.map((row) => {
    const canonical = String(row[refColumn] ?? row.id ?? '');
    const title = (source.titleVia ? viaTitle(row, source.titleVia) : null) ?? asText(row[source.title]) ?? canonical;
    const detail: Record<string, string | null> = {};
    for (const column of asked) if (column !== source.title) detail[column] = clip(asText(row[column]), COLUMN_CHARS);
    return {
      table,
      ref: canonical,
      title: clip(title, 200) ?? canonical,
      href: source.href ? source.href(canonical) : fallbackHref(source),
      detail,
    };
  });

  const order = `${orderColumn} ${ascending ? 'ascending' : 'descending'}`;
  const notes = [
    `Read ${what} in ${table}, by ${order}: ${matchedNote(matched, rows.length)}.`,
    source.note ? `About this table: ${source.note}` : null,
  ].filter(Boolean);
  return { ok: true, rows, totals: { matched, shown: rows.length }, note: notes.join(' ') };
}
