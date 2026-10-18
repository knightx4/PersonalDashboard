/**
 * A page whose views and table filters live in its address, and the filter
 * menus its table's column headers open (plan #2341.2).
 *
 * Pipeline was the first page built this way (lib/jobs/pipeline-view.ts,
 * lib/jobs/pipeline-columns.ts). What is not about applications moved here, so
 * another page can give its own path, defaults and columns and get the same
 * links and the same header menus. Sorting, grouping and hidden columns are
 * the Display panel's, in lib/list-display.ts; this module is the rest.
 */

/** The search params a page reads, as the router hands them over. */
export type AddressParams = Record<string, string | string[] | undefined>;

/** What a link changes: a value sets the param, undefined takes it out. */
export type AddressChanges<P extends AddressParams> = Partial<Record<keyof P & string, string | undefined>>;

/** Where a page lives, and the values its bare address already means. */
export type PageAddress<P extends AddressParams> = {
  path: string;
  /** Left out of a link when equal, so the bare page is the bare link. */
  defaults?: Partial<Record<keyof P & string, string>>;
};

/** How many rows a table draws at once, unless the page says otherwise. */
export const TABLE_PAGE_SIZE = 50;

/** The params as plain strings, the way a link carries them. */
function flatten(params: AddressParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      if (value.length) out[key] = value.join(',');
    } else if (value) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The link that changes `changes` and keeps everything else. A filter or a
 * view change goes back to the first page, since page 4 of a different list
 * is nobody's place in it; only a change of page keeps the page.
 */
export function addressHref<P extends AddressParams>(
  address: PageAddress<P>,
  params: P,
  changes: AddressChanges<P>,
): string {
  const next = flatten(params);
  if (!('page' in changes)) delete next.page;
  for (const [key, value] of Object.entries(changes)) {
    if (value) next[key] = value;
    else delete next[key];
  }
  for (const [key, value] of Object.entries(address.defaults ?? {})) {
    if (next[key] === value) delete next[key];
  }
  if (next.page === '1') delete next.page;
  const query = new URLSearchParams(next).toString();
  return query ? `${address.path}?${query}` : address.path;
}

/** The view an address asks for, or the page's default when it names none it has. */
export function parseView<V extends string>(value: string | undefined, views: readonly V[], fallback: V): V {
  return views.find((view) => view === value) ?? fallback;
}

/** A one-based page number from the address; anything else is the first page. */
export function parsePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 1 ? page : 1;
}

/** The page of `rows` to draw, with where it starts and how many pages there are. */
export function pageOf<T>(
  rows: readonly T[],
  page: number,
  size = TABLE_PAGE_SIZE,
): { rows: T[]; page: number; pages: number; first: number; last: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pages,
    first: slice.length ? start + 1 : 0,
    last: start + slice.length,
  };
}

/** The params without the page, for the links that rearrange the table. */
export function withoutPage<P extends AddressParams>(params: P): P {
  const rest = { ...params };
  delete rest.page;
  return rest;
}

// Column filters ------------------------------------------------------------

/** One entry in a column header's menu, as a link. */
export type ColumnFilterChoice = { id: string; label: string; href: string; current: boolean };

/**
 * A text column's typed filter: the param a field in its menu sets as you
 * type, and what the field says before anything is in it (plan #2341.3).
 */
export type ColumnTyped = { param: string; placeholder: string };

/** A column's choices, and whether one of them other than "any" is set. */
export type ColumnFilter = { active: boolean; choices: ColumnFilterChoice[]; typed?: ColumnTyped };

/** A choice before its link is built: what it changes in the address. */
export type ColumnOption<P extends AddressParams> = {
  id: string;
  label: string;
  changes: AddressChanges<P>;
  current: boolean;
};

/** A column that filters: its id (the Display panel's), and its choices. */
export type FilterColumn<P extends AddressParams> = {
  id: string;
  active: boolean;
  options: readonly ColumnOption<P>[];
  /** A field above the choices that narrows by a typed value, for a text column. */
  typed?: ColumnTyped;
};

/**
 * The menu each filtering column's header opens, by column id. Each choice is
 * a link made by `href`, the page's own, so a header and a filter chip set the
 * same address. A column left out (or passed as false) has its sort alone.
 */
export function columnFilters<P extends AddressParams>(
  columns: readonly (FilterColumn<P> | false | null | undefined)[],
  href: (changes: AddressChanges<P>) => string,
): Record<string, ColumnFilter> {
  const filters: Record<string, ColumnFilter> = {};
  for (const column of columns) {
    if (!column) continue;
    filters[column.id] = {
      active: column.active,
      choices: column.options.map(({ id, label, changes, current }) => ({ id, label, href: href(changes), current })),
      ...(column.typed ? { typed: column.typed } : {}),
    };
  }
  return filters;
}

/**
 * The common column: one param, an "any" choice that clears it, then one
 * choice a value. Choice ids are `<prefix>-<value>`, and the "any" one is
 * `any`.
 */
export function choiceColumn<P extends AddressParams>({
  id,
  param,
  current,
  anyLabel,
  choices,
  prefix = id,
}: {
  id: string;
  param: keyof P & string;
  /** The value set now, as the address spells it, or null for any. */
  current: string | null;
  anyLabel: string;
  choices: readonly { value: string; label: string }[];
  /** For the choice ids, when they should not start with the column id. */
  prefix?: string;
}): FilterColumn<P> {
  const set = (value: string | undefined) => ({ [param]: value }) as AddressChanges<P>;
  return {
    id,
    active: current !== null,
    options: [
      { id: 'any', label: anyLabel, changes: set(undefined), current: current === null },
      ...choices.map(({ value, label }) => ({
        id: `${prefix}-${value}`,
        label,
        changes: set(value),
        current: current === value,
      })),
    ],
  };
}

/**
 * The values a column holds most often among `rows`, then by name, at most
 * `limit` of them; the one chosen is always listed, so the menu can show where
 * you are. For a column of many values, such as companies.
 */
export function commonValues<T>(
  rows: readonly T[],
  key: (row: T) => string,
  name: (row: T) => string,
  limit: number,
  chosen: string | null,
): { value: string; name: string; count: number }[] {
  const byValue = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    const value = key(row);
    const entry = byValue.get(value) ?? { name: name(row), count: 0 };
    entry.count += 1;
    byValue.set(value, entry);
  }
  const common = [...byValue.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
  if (chosen && !common.some(([value]) => value === chosen)) {
    const entry = byValue.get(chosen);
    if (entry) common.push([chosen, entry]);
  }
  return common.map(([value, entry]) => ({ value, ...entry }));
}
