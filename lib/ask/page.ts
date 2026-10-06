import { MODULES, type ModuleId } from '@/lib/modules';
import type { Source } from '@/lib/sources/types';
import { clip, isUuid, type AskContext } from './db';
import { OPENABLE } from './lookups';
import { pathOf } from './page-name';
import { executeAskTool } from './tools';

export { pathOf };

/**
 * Which page an address is, and which row it shows (plan #1270), so Ask Dash
 * can be told what "this" means.
 *
 * The catalogue already says where each row opens (`Source.href`). Rather
 * than keep a second list of routes, this reads those functions backwards:
 * each is called with a marker ref, and what comes back either contains the
 * marker, which gives the text before and after a ref, or does not, which
 * means the page lists rows rather than showing one. An address is matched
 * against the patterns; the row's title is then read through open_row, so
 * the owner filter and the switched-off-workspace check are the ones Dash's
 * own lookups use.
 *
 * `matchPage` is pure and needs no database; `resolvePage` adds the title.
 */

/** Letters only, so neither encodeURIComponent nor noteHref changes it. */
const MARKER = 'zzpagerefzz';

/** A per-row page: the address around a ref, and how to read the row. */
export type RowPattern = {
  table: string;
  /** The address up to the ref. */
  before: string;
  /** The address after the ref; empty for every page today. */
  after: string;
  /** A vault path keeps its slashes in the address; nothing else's ref has one. */
  slashes: boolean;
  /** Refs stored in an `id` column are uuids, so `/goals/all` is not a goal. */
  uuid: boolean;
  /** What one row is called, for the page's name. */
  noun: string;
};

/**
 * Pages that show one row of a table the catalogue does not list as a
 * source. Goals are the goals skill's own tables (lib/goals/sources.ts), so
 * they have no `href` there, but a goal's page is the one most worth knowing.
 */
type ExtraPage = {
  table: string;
  href: (ref: string) => string;
  title: string;
  module: ModuleId;
};

const EXTRA_PAGES: readonly ExtraPage[] = [
  { table: 'goals.items', href: (id) => `/goals/${id}`, title: 'title', module: 'goals' },
  { table: 'goals.areas', href: (id) => `/goals/area/${id}`, title: 'name', module: 'goals' },
];

/** What a row is called where the table's own name does not say it. */
const NOUNS: Record<string, string> = {
  'goals.items': 'goal',
  'goals.areas': 'area',
  'core.files': 'file',
  'news.issues': 'newsletter issue',
  'obsidian.themes': 'theme',
  'public.saved_items': 'saved item',
  'public.inventory_items': 'owned item',
};

function nounOf(table: string): string {
  if (NOUNS[table]) return NOUNS[table];
  const name = table.split('.')[1].replace(/_/g, ' ');
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('zzes')) return name.slice(0, -3);
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

/**
 * The pattern an href function makes, or null when it ignores its ref or puts
 * it only in the fragment. A fragment ref is a list page scrolled to one of
 * its rows, such as a course on the vault's Education tab (plan #1308): the
 * page shows every row, and the fragment never reaches the path this matches.
 */
export function patternOf(table: string, href: (ref: string) => string, refColumn = 'id'): RowPattern | null {
  const sample = href(MARKER);
  const at = sample.indexOf(MARKER);
  if (at < 0) return null;
  const hash = sample.indexOf('#');
  if (hash >= 0 && hash < at) return null;
  return {
    table,
    before: sample.slice(0, at),
    after: sample.slice(at + MARKER.length),
    slashes: href(`${MARKER}/${MARKER}`).includes(`${MARKER}/${MARKER}`),
    uuid: refColumn === 'id',
    noun: nounOf(table),
  };
}

function patternsFrom(sources: readonly Source[]): RowPattern[] {
  const patterns: RowPattern[] = [];
  for (const source of sources) {
    if (!source.href) continue;
    const pattern = patternOf(source.table, source.href, source.ref ?? 'id');
    if (pattern) patterns.push(pattern);
  }
  for (const page of EXTRA_PAGES) patterns.push(patternOf(page.table, page.href)!);
  // The longest prefix first, so a more particular page wins over a broader one.
  return patterns.sort((a, b) => b.before.length - a.before.length);
}

/** Every per-row page Dash can be told about. */
export const ROW_PATTERNS: readonly RowPattern[] = patternsFrom(OPENABLE);

/** An address, as `matchPage` reads it. */
export type PageMatch = {
  /** The path alone: no query, no fragment, no trailing slash. */
  path: string;
  /** The workspace the address is in; null for home, the account page and the like. */
  module: ModuleId | null;
  /** What to call the page: "Job search: pipeline", or "Learn reading" on a row's page. */
  page: string;
  /** The row the page shows, when it shows one. */
  row: { table: string; ref: string } | null;
};

function matchRow(path: string, patterns: readonly RowPattern[]): { table: string; ref: string; noun: string } | null {
  for (const pattern of patterns) {
    if (!path.startsWith(pattern.before) || !path.endsWith(pattern.after)) continue;
    const raw = path.slice(pattern.before.length, path.length - pattern.after.length);
    if (!raw || (!pattern.slashes && raw.includes('/'))) continue;
    let ref: string;
    try {
      ref = decodeURIComponent(raw);
    } catch {
      continue;
    }
    if (pattern.uuid && !isUuid(ref)) continue;
    return { table: pattern.table, ref, noun: pattern.noun };
  }
  return null;
}

function moduleOf(path: string) {
  return MODULES.find((m) => path === m.prefix || path.startsWith(`${m.prefix}/`)) ?? null;
}

/** "all" from /todo/all, "calendar" from /todo/calendar, the words of the rest. */
function wordsOf(segments: readonly string[]): string {
  return segments
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join(' ')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/**
 * Which page an address is and which row it shows, without reading anything.
 * `patterns` is there for tests; the app uses the catalogue's.
 */
export function matchPage(address: string, patterns: readonly RowPattern[] = ROW_PATTERNS): PageMatch {
  const path = pathOf(address);
  const workspace = moduleOf(path);
  const row = matchRow(path, patterns);
  if (row) {
    return {
      path,
      module: workspace?.id ?? null,
      page: workspace ? `${workspace.label} ${row.noun}` : upperFirst(row.noun),
      row: { table: row.table, ref: row.ref },
    };
  }

  if (!workspace) {
    const words = wordsOf(path.split('/').filter(Boolean));
    return { path, module: null, page: words ? upperFirst(words) : 'Home', row: null };
  }
  const words = wordsOf(path.slice(workspace.prefix.length).split('/').filter(Boolean));
  return {
    path,
    module: workspace.id,
    page: words ? `${workspace.label}: ${words}` : workspace.label,
    row: null,
  };
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A page with its row read: what Ask Dash is told, and what the sheet shows. */
export type PageContext = {
  path: string;
  module: ModuleId | null;
  page: string;
  /**
   * The row, when the page shows one that is the asker's and in a workspace
   * that is on. Its `table` and `ref` are what open_row takes.
   */
  row: { table: string; ref: string; title: string; href: string } | null;
};

/**
 * Read the row an address shows. Another person's row, one that has gone,
 * one in a switched-off workspace or a failed read all give the page without
 * a row: the page is still worth telling Dash, and a guess is not.
 */
export async function resolvePage(ctx: AskContext, address: string): Promise<PageContext> {
  const match = matchPage(address);
  const base = { path: match.path, module: match.module, page: match.page, row: null };
  if (!match.row) return base;

  const extra = EXTRA_PAGES.find((p) => p.table === match.row!.table);
  if (extra) {
    const row = await readExtra(ctx, extra, match.row.ref);
    return row ? { ...base, row } : base;
  }

  const result = await executeAskTool('open_row', match.row, ctx);
  const found = result.ok ? result.rows[0] : undefined;
  if (!found) return base;
  return { ...base, row: { table: found.table, ref: found.ref, title: found.title, href: found.href } };
}

async function readExtra(
  ctx: AskContext,
  page: ExtraPage,
  ref: string,
): Promise<PageContext['row']> {
  if (!ctx.enabledModules.includes(page.module)) return null;
  const [schema, name] = page.table.split('.') as ['goals', string];
  try {
    const client = await ctx.db(schema);
    const { data, error } = await client
      .from(name)
      .select(`id, ${page.title}`)
      .eq('user_id', ctx.userId)
      .eq('id', ref)
      .limit(1);
    if (error) return null;
    const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
    if (!row) return null;
    const title = clip(typeof row[page.title] === 'string' ? (row[page.title] as string) : null, 200);
    return { table: page.table, ref, title: title ?? ref, href: page.href(ref) };
  } catch {
    return null;
  }
}
