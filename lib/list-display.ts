/**
 * The display options a long list offers: how it is sorted, how it is grouped,
 * and which properties are turned off.
 *
 * A page declares what it offers — its sorts, its groupings, the properties a
 * row can drop — and this file reads the chosen ones out of the search params,
 * applies them to the rows, and builds the links that change them. Every choice
 * rides in the URL, so a view can be bookmarked or sent to somebody, and the
 * parameters a page already carries (its search, its filters) survive a change
 * of sort untouched.
 *
 * A grouping is not a reordering: each bucket carries its count and a subtotal
 * the page works out, so a list of orders totals money where a list of roles
 * counts rows.
 *
 * Nothing here touches React or the database. The declaration, the parsing, the
 * bucketing and the link building are plain functions, which is what lets one
 * control draw them for every list.
 */

/** Search params in the shape a Next page receives them. */
export type ListSearchParams = Record<string, string | string[] | undefined>;

/** One sort a list offers, and the comparator behind it. */
export type SortDefinition<T> = {
  id: string;
  label: string;
  compare: (a: T, b: T) => number;
};

/**
 * The bucket a row belongs to under one grouping. `rank` orders buckets that
 * have an order of their own — order statuses, role stages — and beats the
 * grouping's own ordering rule.
 */
export type GroupBucket = { key: string; label: string; rank?: number };

/** How buckets are put in order when none of them carries a rank. */
export type BucketOrder = 'label' | 'key-asc' | 'key-desc';

/** One grouping a list offers. */
export type GroupDefinition<T> = {
  id: string;
  label: string;
  /** The bucket this row belongs to, or null when it has no value for it. */
  bucket: (row: T) => GroupBucket | null;
  /** Defaults to 'label'. */
  order?: BucketOrder;
  /** Header over the rows with no value. Defaults to 'None'. */
  emptyLabel?: string;
};

/** One property a row draws, and whether it can be turned off. */
export type PropertyDefinition = {
  id: string;
  label: string;
  /** A property the list cannot lose: the item's name, the role's title. */
  alwaysOn?: boolean;
};

/** What a page declares once, beside the page rather than inside it. */
export type ListDisplaySpec<T> = {
  /** Where the links point, e.g. '/shopping/orders'. */
  pathname: string;
  sorts: readonly SortDefinition<T>[];
  groups?: readonly GroupDefinition<T>[];
  properties?: readonly PropertyDefinition[];
  /** Defaults to the first sort. */
  defaultSort?: string;
  /** Defaults to no grouping. */
  defaultGroup?: string;
  /** Parameter names, for a page already using one of these for something else. */
  params?: { sort?: string; group?: string; hidden?: string };
};

/** The grouping id that means "do not group". Never declared by a page. */
export const NO_GROUP = 'none';

/** The key of the bucket holding rows with no value for the grouping. */
export const EMPTY_BUCKET_KEY = '';

const DEFAULT_PARAM_NAMES = { sort: 'sort', group: 'group', hidden: 'hide' } as const;

/** What the URL currently asks for, once it has been checked against the spec. */
export type ListDisplayState<T> = {
  sort: string;
  group: string;
  /** Hideable property ids, in the order the spec declares them. */
  hidden: string[];
  sortBy: SortDefinition<T> | null;
  groupBy: GroupDefinition<T> | null;
};

function paramNames<T>(spec: ListDisplaySpec<T>) {
  return { ...DEFAULT_PARAM_NAMES, ...spec.params };
}

function firstValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

function defaultSortId<T>(spec: ListDisplaySpec<T>): string {
  const declared = spec.sorts.find((sort) => sort.id === spec.defaultSort);
  return declared?.id ?? spec.sorts[0]?.id ?? '';
}

function defaultGroupId<T>(spec: ListDisplaySpec<T>): string {
  const declared = spec.groups?.find((group) => group.id === spec.defaultGroup);
  return declared?.id ?? NO_GROUP;
}

/** The properties this list can actually turn off. */
export function hideableProperties<T>(spec: ListDisplaySpec<T>): PropertyDefinition[] {
  return (spec.properties ?? []).filter((property) => !property.alwaysOn);
}

/**
 * Ids read off the URL, as either `hide=a,b` or a repeated `hide=a&hide=b`.
 * Anything the spec does not declare as hideable is dropped, so a stale link
 * loses the property it no longer knows about rather than hiding nothing.
 */
function parseHidden<T>(spec: ListDisplaySpec<T>, raw: string | string[] | undefined): string[] {
  const entries = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const asked = new Set(
    entries.flatMap((entry) =>
      typeof entry === 'string' ? entry.split(',').map((id) => id.trim()).filter(Boolean) : [],
    ),
  );
  return hideableProperties(spec)
    .filter((property) => asked.has(property.id))
    .map((property) => property.id);
}

/**
 * Read the search params against what the page offers. An option the spec does
 * not declare falls back to the default rather than emptying the list, because
 * the URL is hand-editable and a typo should not cost the rows.
 */
export function parseListDisplay<T>(
  spec: ListDisplaySpec<T>,
  params: ListSearchParams,
): ListDisplayState<T> {
  const names = paramNames(spec);
  const askedSort = firstValue(params[names.sort]);
  const askedGroup = firstValue(params[names.group]);

  const sort = spec.sorts.find((option) => option.id === askedSort)?.id ?? defaultSortId(spec);
  const group =
    askedGroup === NO_GROUP
      ? NO_GROUP
      : (spec.groups?.find((option) => option.id === askedGroup)?.id ?? defaultGroupId(spec));

  return {
    sort,
    group,
    hidden: parseHidden(spec, params[names.hidden]),
    sortBy: spec.sorts.find((option) => option.id === sort) ?? null,
    groupBy: spec.groups?.find((option) => option.id === group) ?? null,
  };
}

/** Whether a property is currently turned off. */
export function isHidden<T>(state: ListDisplayState<T>, propertyId: string): boolean {
  return state.hidden.includes(propertyId);
}

/** The properties still being drawn, in declaration order. */
export function visibleProperties<T>(
  spec: ListDisplaySpec<T>,
  state: ListDisplayState<T>,
): PropertyDefinition[] {
  return (spec.properties ?? []).filter((property) => !state.hidden.includes(property.id));
}

/** Sort a copy of the rows by the chosen sort. No sort chosen leaves the order alone. */
export function sortRows<T>(rows: readonly T[], state: ListDisplayState<T>): T[] {
  const copy = [...rows];
  return state.sortBy ? copy.sort(state.sortBy.compare) : copy;
}

/** One bucket of a grouped list, with its count and the subtotal the page works out. */
export type ListGroup<T, S> = {
  key: string;
  label: string;
  rows: T[];
  count: number;
  subtotal: S;
};

function compareBuckets(a: GroupBucket, b: GroupBucket, order: BucketOrder): number {
  if (a.key === EMPTY_BUCKET_KEY) return b.key === EMPTY_BUCKET_KEY ? 0 : 1;
  if (b.key === EMPTY_BUCKET_KEY) return -1;
  if (a.rank != null && b.rank != null && a.rank !== b.rank) return a.rank - b.rank;
  if (a.rank != null && b.rank == null) return -1;
  if (a.rank == null && b.rank != null) return 1;
  if (order === 'key-asc') return a.key.localeCompare(b.key);
  if (order === 'key-desc') return b.key.localeCompare(a.key);
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

/**
 * Put the rows in buckets, each carrying its count and its subtotal. Rows with
 * no value for the grouping land in one bucket at the end. With no grouping the
 * whole list comes back as a single bucket, so a page draws the same shape
 * either way.
 */
export function groupRows<T, S = undefined>(
  rows: readonly T[],
  group: GroupDefinition<T> | null,
  subtotal?: (rows: T[]) => S,
): ListGroup<T, S | undefined>[] {
  const total = (bucketRows: T[]) => (subtotal ? subtotal(bucketRows) : undefined);

  if (!group) {
    const all = [...rows];
    return [{ key: 'all', label: 'All', rows: all, count: all.length, subtotal: total(all) }];
  }

  const buckets = new Map<string, { bucket: GroupBucket; rows: T[] }>();
  for (const row of rows) {
    const bucket = group.bucket(row) ?? {
      key: EMPTY_BUCKET_KEY,
      label: group.emptyLabel ?? 'None',
    };
    const existing = buckets.get(bucket.key);
    if (existing) existing.rows.push(row);
    else buckets.set(bucket.key, { bucket, rows: [row] });
  }

  return [...buckets.values()]
    .sort((a, b) => compareBuckets(a.bucket, b.bucket, group.order ?? 'label'))
    .map(({ bucket, rows: bucketRows }) => ({
      key: bucket.key,
      label: bucket.label,
      rows: bucketRows,
      count: bucketRows.length,
      subtotal: total(bucketRows),
    }));
}

/** Turning one property off, or back on, from what is hidden now. */
export function toggleHidden(hidden: readonly string[], propertyId: string): string[] {
  return hidden.includes(propertyId)
    ? hidden.filter((id) => id !== propertyId)
    : [...hidden, propertyId];
}

/** A change to one of the three display options. Anything left out stays as it is. */
export type DisplayChange = {
  sort?: string;
  group?: string;
  hidden?: readonly string[];
  /** Turn one property off, or back on. */
  toggleProperty?: string;
};

/**
 * The link that makes one change and keeps everything else in the URL — the
 * search, the filters, the page's own parameters. A choice that is the page's
 * default is left out, so the links a page hands out stay the ones it hands out
 * today.
 */
export function displayHref<T>(
  spec: ListDisplaySpec<T>,
  params: ListSearchParams,
  change: DisplayChange = {},
): string {
  const names = paramNames(spec);
  const current = parseListDisplay(spec, params);

  const asked = { ...params };
  if (change.sort !== undefined) asked[names.sort] = change.sort;
  if (change.group !== undefined) asked[names.group] = change.group;
  if (change.hidden !== undefined) asked[names.hidden] = [...change.hidden].join(',');
  if (change.toggleProperty !== undefined) {
    asked[names.hidden] = toggleHidden(current.hidden, change.toggleProperty).join(',');
  }
  const next = parseListDisplay(spec, asked);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === names.sort || key === names.group || key === names.hidden) continue;
    if (value == null) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== '') query.append(key, entry);
    }
  }
  if (next.sort && next.sort !== defaultSortId(spec)) query.set(names.sort, next.sort);
  if (next.group !== defaultGroupId(spec)) query.set(names.group, next.group);
  if (next.hidden.length > 0) query.set(names.hidden, next.hidden.join(','));

  const qs = query.toString();
  return qs ? `${spec.pathname}?${qs}` : spec.pathname;
}

/** One choice in the display control: a sort, or a grouping. */
export type DisplayChoice = { id: string; label: string; href: string; chosen: boolean };

/** One property switch, which is on or off rather than one of a set. */
export type DisplayToggle = { id: string; label: string; href: string; hidden: boolean };

/**
 * What the control draws: labels, links, and which of them is in force.
 *
 * The spec carries comparators and bucket functions, and neither can be handed
 * to a client component, so a page turns its spec into this on the server and
 * passes the rows. It is also why the control never imports a page's options:
 * every list arrives here in the same shape.
 */
export type ListDisplayMenu = {
  sorts: DisplayChoice[];
  /** Empty when the list declares no groupings; otherwise led by "No grouping". */
  groups: DisplayChoice[];
  properties: DisplayToggle[];
  /** What the button can say about the arrangement without opening the panel. */
  sortLabel: string | null;
  groupLabel: string | null;
  hiddenCount: number;
};

/** The label of the grouping row that turns grouping off. */
const NO_GROUP_LABEL = 'No grouping';

/** Every choice the control offers, each with the link that makes it. */
export function listDisplayMenu<T>(
  spec: ListDisplaySpec<T>,
  params: ListSearchParams,
): ListDisplayMenu {
  const state = parseListDisplay(spec, params);
  const groups = spec.groups ?? [];

  return {
    sorts: spec.sorts.map((sort) => ({
      id: sort.id,
      label: sort.label,
      href: displayHref(spec, params, { sort: sort.id }),
      chosen: sort.id === state.sort,
    })),
    groups:
      groups.length === 0
        ? []
        : [
            {
              id: NO_GROUP,
              label: NO_GROUP_LABEL,
              href: displayHref(spec, params, { group: NO_GROUP }),
              chosen: state.group === NO_GROUP,
            },
            ...groups.map((group) => ({
              id: group.id,
              label: group.label,
              href: displayHref(spec, params, { group: group.id }),
              chosen: group.id === state.group,
            })),
          ],
    properties: hideableProperties(spec).map((property) => ({
      id: property.id,
      label: property.label,
      href: displayHref(spec, params, { toggleProperty: property.id }),
      hidden: state.hidden.includes(property.id),
    })),
    sortLabel: state.sortBy?.label ?? null,
    groupLabel: state.groupBy?.label ?? null,
    hiddenCount: state.hidden.length,
  };
}
