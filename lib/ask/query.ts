import type { Source } from '@/lib/sources/types';
import { AskInputError, clip, MATCHED_SET_CAP, matchedNote, optionalString, type AskContext, type AskRow, type AskSchema, type AskToolResult } from './db';
import { asText, fallbackHref, LISTABLE, listableSource, ownerColumn, sourceWorkspace, viaTitle } from './list-rows';
import { listableShapes, type TableColumn, type TableShape } from './table-info';

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
 * A condition is parsed into a `Condition` of one of two kinds. `column`
 * compares one of the table's own columns. `linked` (plan #2109.5) keeps the
 * rows that have, or lack, a row of another table linked to them by a foreign
 * key, so "which applications have no answers" is one call:
 *
 * - When this table holds the key (applications.role_id), the condition is
 *   the key column being set or not.
 * - When the other table holds it (application_answers.application_id), the
 *   other table is embedded under an alias, its rows filtered to the person,
 *   and the alias is tested for null: PostgREST's anti-join, and with
 *   `not.is.null` its semi-join. PostgREST embeds only within one schema, so a
 *   link of this kind from another schema is refused with the ones that work.
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

/** The most linked conditions one call takes. */
const LINKED_MAX = 5;

/** A row's own column compared with a value. */
export type ColumnCondition = {
  kind: 'column';
  column: string;
  op: QueryOp;
  /** A scalar for equals, not_equals, greater, less and contains; a list for one_of; absent for empty and not_empty. */
  value: Scalar | Scalar[] | null;
  type: string;
};

/**
 * The row has (present) or lacks a row of `table` linked to it. `holder` says
 * which side holds the key: 'this' when it is this table's column `via`, and
 * 'other' when it is `via` on the other table, which is then embedded as
 * `alias` and filtered to `owner` = `userId`.
 */
export type LinkedCondition = {
  kind: 'linked';
  table: string;
  present: boolean;
  holder: 'this' | 'other';
  via: string;
  alias: string;
  owner: string;
  userId: string;
};

/** One condition a row must meet. */
export type Condition = ColumnCondition | LinkedCondition;

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
export function parseConditions(raw: unknown, table: string, columns: Map<string, TableColumn>): ColumnCondition[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AskInputError('where must be a list of conditions.');
  return raw.map((item, i): ColumnCondition => {
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

/** One way a row of `table` can be linked to a row of another. */
type Link = { other: string; holder: 'this' | 'other'; via: string };

/**
 * Every link between `table` and the readable tables in `open`: the keys this
 * table holds, then the keys other tables hold that point at it. A table that
 * points at itself (a parent_id) is listed once, as the other side, since
 * "has a parent" is already the key column being set.
 */
function linksOf(table: string, shapes: Map<string, TableShape>, open: ReadonlySet<string>): Link[] {
  const holds: Link[] = (shapes.get(table)?.links ?? [])
    .filter((l) => open.has(l.table) && l.table !== table)
    .map((l) => ({ other: l.table, holder: 'this', via: l.column }));
  const heldBy: Link[] = [...shapes]
    .filter(([name]) => open.has(name))
    .flatMap(([name, s]) =>
      s.links.filter((l) => l.table === table).map((l) => ({ other: name, holder: 'other' as const, via: l.column })),
    );
  return [...holds, ...heldBy];
}

function linkWords(links: readonly Link[]): string {
  if (links.length === 0) return 'none';
  return links.map((l) => `${l.other} via ${l.via}`).join(', ');
}

/**
 * The linked conditions as given: each names a readable table linked to this
 * one, whether a linked row must be there, and, where the two tables are
 * linked more than one way, the key column to follow.
 */
export function parseLinked(
  raw: unknown,
  table: string,
  shapes: Map<string, TableShape>,
  open: ReadonlySet<string>,
  userId: string,
): LinkedCondition[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AskInputError('linked must be a list of conditions.');
  if (raw.length > LINKED_MAX) throw new AskInputError(`Give at most ${LINKED_MAX} linked conditions.`);
  const links = linksOf(table, shapes, open);
  const schema = table.split('.')[0];
  return raw.map((item, i): LinkedCondition => {
    if (!item || typeof item !== 'object') throw new AskInputError(`Linked condition ${i + 1} must be an object.`);
    const c = item as Record<string, unknown>;
    const other = typeof c.table === 'string' ? c.table.trim() : '';
    if (typeof c.present !== 'boolean') {
      throw new AskInputError(
        `Linked condition ${i + 1} needs present: true for rows that have a linked row, false for rows that have none.`,
      );
    }
    const via = typeof c.via === 'string' && c.via.trim() ? c.via.trim() : null;
    const found = links.filter((l) => l.other === other && (!via || l.via === via));
    if (found.length === 0) {
      const what = other
        ? `${table} is not linked to ${other}${via ? ` via ${via}` : ''}.`
        : `Linked condition ${i + 1} needs a table.`;
      throw new AskInputError(`${what} Its links: ${linkWords(links)}.`);
    }
    if (found.length > 1) {
      throw new AskInputError(
        `${table} is linked to ${other} more than one way; give via, one of: ${found.map((l) => l.via).join(', ')}.`,
      );
    }
    const link = found[0];
    if (link.holder === 'other' && other.split('.')[0] !== schema) {
      const usable = links.filter((l) => l.holder === 'this' || l.other.split('.')[0] === schema);
      throw new AskInputError(
        `${other} is in another schema, and a query can only follow its link to ${table} within one. Query ${other} instead, or use one of: ${linkWords(usable)}.`,
      );
    }
    const source = listableSource(other);
    return {
      kind: 'linked',
      table: other,
      present: c.present,
      holder: link.holder,
      via: link.via,
      alias: `linked_${i}`,
      owner: (source && ownerColumn(source)) ?? 'user_id',
      userId,
    };
  });
}

/** The embeds that linked conditions on keys held by other tables add to a select. */
export function linkedEmbeds(conditions: readonly Condition[]): string[] {
  return conditions
    .filter((c): c is LinkedCondition => c.kind === 'linked' && c.holder === 'other')
    .map((c) => `${c.alias}:${c.table.split('.')[1]}!${c.via}(${c.via})`);
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
  if (c.kind === 'linked') {
    if (c.holder === 'this') return c.present ? query.not(c.via, 'is', null) : query.is(c.via, null);
    // Only the person's own linked rows count, as row level security also says.
    const own = query.eq(`${c.alias}.${c.owner}`, c.userId);
    return c.present ? own.not(c.alias, 'is', null) : own.is(c.alias, null);
  }
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
    .map((c) =>
      c.kind === 'linked'
        ? `${c.present ? 'a' : 'no'} ${c.table} row is linked (via ${c.via})`
        : [c.column, words[c.op], c.value === null ? null : JSON.stringify(c.value)].filter(Boolean).join(' '),
    )
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

  const shapes = await listableShapes(ctx);
  const columns = new Map((shapes.get(table)?.columns ?? []).map((c) => [c.column, c]));
  if (columns.size === 0) throw new Error(`${table}: no columns came back from ask_table_columns`);

  const open = new Set(
    LISTABLE.filter((s) => {
      const w = sourceWorkspace(s);
      return !w || ctx.enabledModules.includes(w);
    }).map((s) => s.table),
  );
  const conditions: Condition[] = [
    ...parseConditions(input.where, table, columns),
    ...parseLinked(input.linked, table, shapes, open, ctx.userId),
  ];
  const embeds = linkedEmbeds(conditions);
  const groupBy = input.group_by === undefined || input.group_by === null ? null : columnOf(columns, table, input.group_by, 'group_by');
  const countOnly = input.count_only === true;
  if (groupBy && countOnly) throw new AskInputError('Give group_by or count_only, not both: group_by already counts.');

  const [schema, name] = table.split('.') as [AskSchema, string];
  const owner = ownerColumn(source) as string;
  const client = await ctx.db(schema);
  const scoped = (select: string, options?: { count: 'exact'; head?: boolean }) => {
    let query = client.from(name).select([select, ...embeds].join(', '), options).eq(owner, ctx.userId);
    for (const c of conditions) query = applyCondition(query, c);
    return query;
  };
  const what = describe(conditions);
  // Every matched row's ref, for the set a write can name (plan #2472.1).
  const refColumn = source.ref ?? 'id';
  const allRefs: RefsPage = () => scoped(refColumn).order(refColumn).range(0, MATCHED_SET_CAP - 1);

  if (countOnly) {
    const { count, error } = await scoped(owner, { count: 'exact', head: true });
    if (error) throw new AskInputError(`${table} refused the query: ${error.message}`);
    const matched = count ?? 0;
    return {
      ok: true,
      rows: [],
      totals: { matched, shown: 0 },
      note: `Counted ${what} in ${table}: ${matched} matched, listing none (count_only).`,
      matchedSet: await setOf(table, refColumn, matched, null, allRefs),
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

  return listed(
    table,
    source,
    columns,
    input,
    what,
    (select, order, ascending, limit) =>
      scoped(select, { count: 'exact' }).order(order, { ascending, nullsFirst: false }).range(0, limit - 1),
    allRefs,
  );
}

type Page = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>;
/** The refs of the rows that match, up to MATCHED_SET_CAP. */
type RefsPage = () => Page;

/**
 * Every row that matched, as the set runDash names: the refs already read
 * when the listing holds them all, otherwise read once more, and none when
 * more than MATCHED_SET_CAP matched, since a change could not take them.
 */
async function setOf(
  table: string,
  refColumn: string,
  matched: number,
  listed: string[] | null,
  refs: RefsPage,
): Promise<{ table: string; refs: string[]; matched: number }> {
  if (matched === 0 || matched > MATCHED_SET_CAP) return { table, refs: [], matched };
  if (listed && listed.length >= matched) return { table, refs: listed, matched };
  const { data, error } = await refs();
  if (error) throw new AskInputError(`${table} refused the query: ${error.message}`);
  const read = ((data ?? []) as Record<string, unknown>[]).map((row) => String(row[refColumn] ?? ''));
  // Rows added or removed between the count and this read: the read is the set.
  return { table, refs: read, matched: read.length < MATCHED_SET_CAP ? read.length : matched };
}

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
  refs: RefsPage,
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
  const listedRefs = found.map((row) => String(row[refColumn] ?? row.id ?? ''));
  return {
    ok: true,
    rows,
    totals: { matched, shown: rows.length },
    note: notes.join(' '),
    matchedSet: await setOf(table, refColumn, matched, listedRefs, refs),
  };
}
