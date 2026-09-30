import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchSource } from '@/lib/search/sources';
import type { ModuleId } from '@/lib/modules';
import type { TalkCitation } from '@/lib/talk/talk';
import type { QuestionEmbedder } from '@/lib/memory/search';

/**
 * What Dash's lookups read with and hand back (plan #1088). No client and no
 * `server-only` here, so the lookups can be tested with a stub in place of
 * the database; lib/ask/clients.ts makes the real clients.
 */

/** The schemas a lookup reads. Each has its own client, bound to that schema. */
export type AskSchema =
  | 'public'
  | 'core'
  | 'job_search'
  | 'obsidian'
  | 'todo'
  | 'learn'
  | 'news'
  | 'goals';

/** A supabase-js client bound to one schema; which one is the caller's business. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchemaClient = SupabaseClient<any, string, any>;

/** The client for a schema, on the person's own session. */
export type AskDb = (schema: AskSchema) => Promise<SchemaClient>;

/** Everything a lookup needs to know about who is asking and when. */
export type AskContext = {
  /** The signed-in person. Every read is filtered to it as well as scoped by RLS. */
  userId: string;
  /** YYYY-MM-DD in the person's timezone: what "overdue" and "a month ago" count from. */
  today: string;
  /** Workspaces that are on. A lookup into one that is off answers that it is off. */
  enabledModules: readonly ModuleId[];
  db: AskDb;
  /** The search registry (allSearchSources()); a stub in tests. */
  searchSources: readonly SearchSource[];
  /** For "the last four weeks" of goal reviews; Date.now() when absent. */
  now?: number;
  /** How recall embeds a question; Voyage when absent, a fake in tests. */
  embedQuestion?: QuestionEmbedder;
};

/**
 * One row a lookup found. `table` and `ref` say which row it is, `href` is
 * where it opens, and `detail` is what the model reads about it. A row
 * without a link is never returned (see `executeAskTool`).
 */
export type AskRow = {
  table: string;
  ref: string;
  title: string;
  href: string;
  detail?: Record<string, string | number | boolean | null>;
};

export type AskToolResult =
  | {
      ok: true;
      rows: AskRow[];
      /** Figures over the rows, or over more rows than were listed. */
      totals?: Record<string, unknown>;
      /** Anything the model should know to read the result: a cap hit, a range assumed. */
      note?: string;
    }
  | { ok: false; error: string };

/** A lookup's rows as the citations a turn may carry (lib/talk/talk.ts). */
export function citationsOf(result: AskToolResult): TalkCitation[] {
  if (!result.ok) return [];
  return result.rows.map(({ table, ref, title, href }) => ({ table, ref, title, href }));
}

/** A result as the text of a tool_result block. */
export function toolResultText(result: AskToolResult): string {
  return JSON.stringify(result);
}

// ---------------------------------------------------------------------------
// Small helpers the lookups share
// ---------------------------------------------------------------------------

export class AskInputError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(value));
}

/** An optional YYYY-MM-DD input, refused when present and malformed. */
export function optionalDate(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (value === undefined || value === null || value === '') return null;
  if (!isDate(value)) throw new AskInputError(`${key} must be a date written YYYY-MM-DD.`);
  return value;
}

export function optionalString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AskInputError(`${key} must be text.`);
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** The day after a YYYY-MM-DD, for an inclusive end compared with a timestamp. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD so many days before another. */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Text cut to a length at a word, for a row the model reads rather than a page. */
export function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Rows whose `column` is one of `values`, read a hundred at a time so a long
 * list of ids never makes a URL too long for PostgREST.
 */
export async function readIn<T>(
  client: SchemaClient,
  table: string,
  columns: string,
  column: string,
  values: readonly string[],
  userId: string | null,
): Promise<T[]> {
  const unique = [...new Set(values)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    let query = client.from(table).select(columns).in(column, unique.slice(i, i + 100));
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}
