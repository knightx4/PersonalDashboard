import { MODULES, type ModuleId } from '@/lib/modules';
import { SOURCES } from '@/lib/sources/catalogue';
import type { Source } from '@/lib/sources/types';
import { AskInputError, clip, optionalString, type AskContext, type AskSchema, type AskToolResult } from './db';

/**
 * list_rows: Dash reading any table in the sources catalogue
 * (lib/sources/catalogue.ts), newest first.
 *
 * The other lookups are written one by one, and for a long time a table no
 * lookup was written for was a table Dash could not see: asked for "a good
 * YouTube video to watch", it said it had no way to, with 122 videos on the
 * person's watch list. This one is built from the catalogue instead, so every
 * table a module declares as holding what the person wrote, wants, did or has
 * is readable the day it is declared. tests/ask-reach.test.ts holds that.
 *
 * Read only, like every lookup: a fixed select on a catalogued table, filtered
 * to the person by its owner column as well as scoped by row level security.
 * A table tied to its owner through a join is left out, since nothing here
 * can filter on it.
 */

/** The most rows read before filtering by words, newest first. */
const READ_ROWS = 300;
/** The most rows returned. */
export const LIST_ROWS_MAX = 40;
const LIST_ROWS_DEFAULT = 20;
/** Characters kept of each column, for each row. open_row reads one row in full. */
const COLUMN_CHARS = 400;

/** The schemas a lookup has a client for (AskSchema). */
const SCHEMAS = new Set<string>(['public', 'core', 'job_search', 'obsidian', 'todo', 'learn', 'news', 'goals']);

/** The owner column, when a table is tied to its owner by one; null when through a join. */
function ownerColumn(source: Source): string | null {
  if (!source.owner) return 'user_id';
  return /^\w+$/.test(source.owner) ? source.owner : null;
}

/** Every catalogued table list_rows can read, in catalogue order. */
export const LISTABLE: readonly Source[] = SOURCES.filter(
  (s) => ownerColumn(s) !== null && SCHEMAS.has(s.table.split('.')[0]),
);

export function listableSource(table: string): Source | null {
  return LISTABLE.find((s) => s.table === table) ?? null;
}

const MODULE_BY_LABEL = new Map(MODULES.map((m) => [m.label, m]));

/** The workspace a source's rows belong to, when it is one that can be switched off. */
export function sourceWorkspace(source: Source): ModuleId | null {
  return MODULE_BY_LABEL.get(source.module)?.id ?? null;
}

/**
 * Where a row with no page of its own is linked: its workspace's front page,
 * so the answer can still cite it. Home for a table that belongs to none.
 */
function fallbackHref(source: Source): string {
  return MODULE_BY_LABEL.get(source.module)?.prefix ?? '/';
}

/** The table list for the tool's description: each table and what it holds. */
export function listableList(): string {
  return LISTABLE.map((s) => `${s.table} (${s.holds.replace(/\.$/, '')})`).join('; ');
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** The embedded row's column, whether PostgREST returned the embed as an object or a one-row list. */
function viaTitle(row: Record<string, unknown>, via: NonNullable<Source['titleVia']>): string | null {
  const alias = via.embed.split(':')[0];
  const embedded = row[alias];
  const one = Array.isArray(embedded) ? embedded[0] : embedded;
  if (!one || typeof one !== 'object') return null;
  return asText((one as Record<string, unknown>)[via.column]);
}

export async function listRowsLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const table = optionalString(input, 'table');
  if (!table) throw new AskInputError('Give the table to list.');
  const source = listableSource(table);
  if (!source) throw new AskInputError(`${table} is not a table list_rows can read. Pick one from its list.`);
  const words = (optionalString(input, 'contains') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const limitIn = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.floor(input.limit) : LIST_ROWS_DEFAULT;
  const limit = Math.min(Math.max(limitIn, 1), LIST_ROWS_MAX);

  const [schema, name] = table.split('.') as [AskSchema, string];
  const refColumn = source.ref ?? 'id';
  const owner = ownerColumn(source) as string;
  const plain = [
    ...new Set([refColumn, ...(refColumn !== owner ? ['id'] : []), source.title, ...source.search, ...(source.facts ?? [])]),
  ];
  const columns = source.titleVia ? [...plain, `${source.titleVia.embed}(${source.titleVia.column})`] : plain;

  // Every listable table has the column it is ordered by (tests/ask-reach.test.ts).
  const client = await ctx.db(schema);
  const { data, error } = await client
    .from(name)
    .select(columns.join(', '))
    .eq(owner, ctx.userId)
    .order(source.newest ?? 'created_at', { ascending: false })
    .limit(READ_ROWS);
  if (error) throw new Error(`${table}: ${error.message}`);
  const all = (data ?? []) as unknown as Record<string, unknown>[];

  const textOf = (row: Record<string, unknown>) =>
    [
      source.titleVia ? viaTitle(row, source.titleVia) : null,
      ...[source.title, ...source.search].map((c) => asText(row[c])),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  const matched = words.length > 0 ? all.filter((row) => words.every((w) => textOf(row).includes(w))) : all;
  const listed = matched.slice(0, limit);

  const rows = listed.map((row) => {
    const canonical = String(row[refColumn] ?? row.id ?? '');
    const title =
      (source.titleVia ? viaTitle(row, source.titleVia) : null) ?? asText(row[source.title]) ?? canonical;
    const detail: Record<string, string | null> = {};
    for (const column of [...source.search, ...(source.facts ?? [])]) {
      if (column !== source.title) detail[column] = clip(asText(row[column]), COLUMN_CHARS);
    }
    return {
      table,
      ref: canonical,
      title: clip(title, 200) ?? canonical,
      href: source.href ? source.href(canonical) : fallbackHref(source),
      detail,
    };
  });

  const scope = all.length === READ_ROWS ? `the newest ${READ_ROWS} of their rows` : `all ${all.length} of their rows`;
  const found = words.length > 0 ? `${matched.length} of ${scope} hold "${words.join(' ')}"` : `Read ${scope}`;
  const shown = matched.length > listed.length ? `; listed the first ${listed.length}` : '';
  const notes = [`${found}${shown}.`, source.note ? `About this table: ${source.note}` : null].filter(Boolean);
  return { ok: true, rows, note: notes.join(' ') };
}
