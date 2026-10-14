import type { Crumb } from '@/components/shell/breadcrumb';
import type { AskDb, AskSchema } from '@/lib/ask/db';
import { pageFor } from '@/lib/sources/catalogue';
import { HOME_CRUMB, workspaceCrumb } from '@/lib/core/section-path';
import type { Page, PageRow, Section } from '@/lib/sources/types';

/**
 * One way to point at a row (docs/CORE-AND-DASH-SPEC.md, Part 1).
 *
 * A ref is `schema.table:id`, the string core.files.origin and the evidence
 * of core.observations already hold. The registry behind it is the sources
 * catalogue: every table with a page has an entry in PAGES
 * (lib/sources/catalogue.ts) saying where a row opens and what it is called.
 *
 * Refs carry no foreign key, so the row may be gone. `refTitles` answers that
 * with `missing`, and the title a page shows for it is NO_LONGER_THERE.
 */

export { HOME_CRUMB };

/** What a page shows for a ref whose row has gone. */
export const NO_LONGER_THERE = 'no longer there';

/** Where a ref whose page needs more than its id opens: app/open/[ref]. */
export const OPEN_PATH = '/open';

/** Longest title a ref is named by; longer ones are cut at a word. */
const TITLE_MAX = 90;

const TABLE = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/;

export type ParsedRef = {
  /** `schema.table`. */
  table: string;
  schema: string;
  name: string;
  /** The row's `id`, as text. */
  id: string;
};

/** A ref split into its table and id, or null when it is not `schema.table:id`. */
export function parseRef(ref: string): ParsedRef | null {
  const colon = ref.indexOf(':');
  if (colon < 0) return null;
  const table = ref.slice(0, colon);
  const id = ref.slice(colon + 1).trim();
  const match = TABLE.exec(table);
  if (!match || !id) return null;
  return { table, schema: match[1], name: match[2], id };
}

/** The ref for one row. */
export function toRef(table: string, id: string): string {
  return `${table}:${id}`;
}

/**
 * The page a ref opens on, or null when its table has no page or the ref is
 * malformed. Where the id alone gives the page (a role, an order, a
 * concept), this is that page. Where the page needs another column (a plan
 * step's number, a note's path), it is app/open/[ref], which reads the row
 * and goes on to its page, or says it is no longer there.
 */
export function refHref(ref: string): string | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const entry = pageFor(parsed.table);
  if (!entry) return null;
  if ((entry.page.reads ?? []).length > 0) {
    return `${OPEN_PATH}/${encodeURIComponent(toRef(parsed.table, parsed.id))}`;
  }
  return entry.page.href({ id: parsed.id });
}

/**
 * What a ref resolves to: the row's title and page, and the ref of the row it
 * sits under (null when it sits under none), or that it has gone.
 */
export type RefTarget =
  | {
      ref: string;
      table: string;
      id: string;
      missing: false;
      title: string;
      href: string | null;
      parent: string | null;
    }
  | { ref: string; table: string | null; id: string | null; missing: true; title: string; href: null; parent: null };

/**
 * Reads the rows of one table by id: `columns` from `table` (`schema.table`)
 * where `id` is one of `ids`. Rows the reader cannot see, because they are
 * gone or not the person's, are simply not returned.
 */
export type ReadRows = (
  table: string,
  columns: readonly string[],
  ids: readonly string[],
) => Promise<PageRow[]>;

/** Every column a page entry reads: id, the title's, the href's and the parent's. */
export function pageColumns(page: Page): string[] {
  const title = typeof page.title === 'string' ? [page.title] : page.title.reads;
  return [...new Set(['id', ...title, ...(page.reads ?? []), ...(page.parent?.reads ?? [])])];
}

/** What one row is called, on one line and not too long; null when it says nothing. */
export function pageTitle(page: Page, row: PageRow): string | null {
  const raw = typeof page.title === 'string' ? row[page.title] : page.title.of(row);
  if (raw === null || raw === undefined) return null;
  const text = (typeof raw === 'string' ? raw : typeof raw === 'object' ? JSON.stringify(raw) : String(raw))
    .trim()
    .split(/\r?\n/)[0]
    .trim();
  if (!text) return null;
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function missing(ref: string, parsed: ParsedRef | null): RefTarget {
  return {
    ref,
    table: parsed?.table ?? null,
    id: parsed?.id ?? null,
    missing: true,
    title: NO_LONGER_THERE,
    href: null,
    parent: null,
  };
}

/**
 * Titles and pages for a batch of refs, with one read per table. A ref whose
 * row is gone, whose table has no page, or that is not a ref at all comes
 * back missing, titled NO_LONGER_THERE and linking nowhere. Keyed by the
 * refs as given.
 */
export async function refTitles(
  refs: readonly string[],
  read: ReadRows,
): Promise<Map<string, RefTarget>> {
  const out = new Map<string, RefTarget>();
  const byTable = new Map<string, { page: Page; ids: Set<string> }>();

  for (const ref of new Set(refs)) {
    const parsed = parseRef(ref);
    const entry = parsed ? pageFor(parsed.table) : null;
    if (!parsed || !entry) {
      out.set(ref, missing(ref, parsed));
      continue;
    }
    const group = byTable.get(parsed.table) ?? { page: entry.page, ids: new Set<string>() };
    group.ids.add(parsed.id);
    byTable.set(parsed.table, group);
  }

  const found = new Map<string, PageRow>();
  await Promise.all(
    [...byTable].map(async ([table, { page, ids }]) => {
      const rows = await read(table, pageColumns(page), [...ids]);
      for (const row of rows) found.set(toRef(table, String(row.id)), row);
    }),
  );

  for (const ref of new Set(refs)) {
    if (out.has(ref)) continue;
    const parsed = parseRef(ref) as ParsedRef;
    const page = byTable.get(parsed.table)!.page;
    const row = found.get(toRef(parsed.table, parsed.id));
    if (!row) {
      out.set(ref, missing(ref, parsed));
      continue;
    }
    out.set(ref, {
      ref,
      table: parsed.table,
      id: parsed.id,
      missing: false,
      title: pageTitle(page, row) ?? 'Untitled',
      href: page.href(row),
      parent: parentRef(page, row, ref),
    });
  }
  return out;
}

/** The ref of the row this one sits under, when it is a ref and not itself. */
function parentRef(page: Page, row: PageRow, own: string): string | null {
  const ref = page.parent?.ref(row) ?? null;
  return ref && ref !== own && parseRef(ref) ? ref : null;
}

/** How many rows above a row a path looks; deeper data is cut off, not looped. */
const PATH_DEPTH = 8;

/**
 * The path to a row, as the breadcrumb draws it (docs/ONE-INTERFACE-SPEC.md
 * Part 2): workspace › section › the rows it sits under › the row. A goal
 * step reads Goals › All goals › Money › Pay off the cards › Call the bank;
 * a role, Job search › Pipeline › Acme › Designer; an order, Shopping ›
 * Orders › Order 1234.
 *
 * The section is the row's own (Page.section), or, for a row that sits under
 * another rather than in a section of its own, the nearest one above it. The
 * workspace is the one whose address the section is under, else Home. A
 * section at the workspace's own address is not named twice, rows of a
 * pass-through table (an application) are walked past, and a row above with
 * no page is left out. The row itself links to its page, or to /open/<ref>
 * when it has none.
 *
 * A row that is gone gives the path to where it was, workspace › section,
 * since its table still says where that is; a parent that is gone ends the
 * path there. Something that is not a ref, or names a table with no page,
 * has no path: an empty list.
 */
export async function refPath(ref: string, read: ReadRows): Promise<Crumb[]> {
  return (await refPaths([ref], read)).get(ref) ?? [];
}

/**
 * The paths for a batch of refs: refTitles once for the refs, then once for
 * each level of rows above them, so a list of rows costs a read per table per
 * level rather than per row. Keyed by the refs as given.
 */
export async function refPaths(refs: readonly string[], read: ReadRows): Promise<Map<string, Crumb[]>> {
  const targets = new Map<string, RefTarget>();
  let level = [...new Set(refs)];
  for (let depth = 0; level.length > 0 && depth <= PATH_DEPTH; depth += 1) {
    const found = await refTitles(level, read);
    for (const [ref, target] of found) targets.set(ref, target);
    level = [
      ...new Set(
        [...found.values()].flatMap((t) => (t.parent && !targets.has(t.parent) ? [t.parent] : [])),
      ),
    ];
  }
  const out = new Map<string, Crumb[]>();
  for (const ref of new Set(refs)) out.set(ref, pathOf(ref, targets));
  return out;
}

function pathOf(ref: string, targets: ReadonlyMap<string, RefTarget>): Crumb[] {
  const leaf = targets.get(ref);
  const parsed = parseRef(ref);
  const entry = parsed ? pageFor(parsed.table) : null;
  if (!leaf || !entry) return [];

  // The row and every row above it that is still there, nearest first.
  const chain: { target: Extract<RefTarget, { missing: false }>; page: Page }[] = [];
  const seen = new Set<string>();
  let at: RefTarget | undefined = leaf;
  while (at && !at.missing && !seen.has(at.ref) && chain.length <= PATH_DEPTH) {
    seen.add(at.ref);
    const page = pageFor(at.table)?.page;
    if (!page) break;
    chain.push({ target: at, page });
    at = at.parent ? targets.get(at.parent) : undefined;
  }

  const section: Section | null =
    entry.page.section ?? chain.map((link) => link.page.section).find((s) => s) ?? null;
  const workspace = workspaceCrumb(section?.href ?? chain[0]?.target.href ?? null);
  const start: Crumb[] = [workspace];
  if (section && section.href !== workspace.href) start.push({ label: section.label, href: section.href });
  if (leaf.missing) return start;

  const above = chain
    .slice(1)
    .reverse()
    .filter((link) => !link.page.passThrough && link.target.href)
    .map((link) => ({ label: link.target.title, href: link.target.href as string }));
  const own: Crumb = { label: leaf.title, href: leaf.href ?? `${OPEN_PATH}/${encodeURIComponent(ref)}` };
  return [...start, ...above, own];
}

/** A uuid, so an id that cannot be one is never sent to a uuid column. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A ReadRows over the app's schema clients, such as requestAskDb() from
 * lib/ask/clients.ts. Row level security decides what is visible, so a row
 * of someone else's reads as missing, the same as a deleted one. Every id
 * column a page entry names is a uuid (tests/refs.test.ts), so an id that is
 * not one is dropped before the read rather than failing it.
 */
export function readRowsWith(db: AskDb): ReadRows {
  return async (table, columns, ids) => {
    const usable = ids.filter((id) => UUID.test(id));
    if (usable.length === 0) return [];
    const [schema, name] = table.split('.');
    const client = await db(schema as AskSchema);
    const { data, error } = await client.from(name).select(columns.join(', ')).in('id', usable);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as unknown as PageRow[];
  };
}
