/**
 * The filter on a list, as Ask Dash is handed it (plan #1658): which list,
 * and the part of its address that narrows it. Dash is sent the filter and
 * never a copy of the rows; the server reads the list again with it
 * (lib/ask/filtered-list.ts), so "these" means the rows the page showed.
 *
 * Pure, with no database, so the page, the sheet and the route all import it.
 */

/** The lists that can be sent to Dash, and the address each is on. */
export const ASK_LISTS = {
  inventory: { path: '/shopping/inventory', name: 'Inventory', one: 'item', many: 'items' },
  pipeline: { path: '/jobs/pipeline', name: 'Pipeline', one: 'role', many: 'roles' },
} as const;

export type AskListId = keyof typeof ASK_LISTS;

/** A list and its filter: `query` holds only the params that narrow it. */
export type AskListFilter = { list: AskListId; query: string };

/** What the sheet is opened with: the filter, and the words it shows above the box. */
export type AskRows = AskListFilter & { label: string };

/** The params that narrow each list. Sort, grouping, view and page do not. */
const FILTER_KEYS: Record<AskListId, readonly string[]> = {
  inventory: ['q', 'category', 'merchant', 'list', 'range', 'person', 'attr'],
  pipeline: ['status', 'source', 'excitement', 'minfit', 'minchance', 'q'],
};

export type ListParams = Record<string, string | string[] | undefined>;

/** The value a param narrows by, or null when it is unset or says "everything". */
function narrowing(list: AskListId, key: string, value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (list === 'inventory' && key === 'range' && text === 'all') return null;
  if (list === 'pipeline' && key === 'status' && text === 'live') return null;
  return text;
}

function entries(list: AskListId, read: (key: string) => string[]): [string, string][] {
  const found: [string, string][] = [];
  for (const key of FILTER_KEYS[list]) {
    for (const value of read(key)) {
      const kept = narrowing(list, key, value);
      if (kept) found.push([key, kept]);
    }
  }
  return found;
}

/**
 * Whether the list is narrowed at all. The pipeline's "all" status is the
 * whole list, so on its own it is no filter, though it is kept in the query
 * beside one that is, since the live applications are the default without it.
 */
function narrowed(list: AskListId, found: readonly [string, string][]): boolean {
  return found.some(([key, value]) => !(list === 'pipeline' && key === 'status' && value === 'all'));
}

function queryOf(found: readonly [string, string][]): string {
  const params = new URLSearchParams();
  for (const [key, value] of found) params.append(key, value);
  return params.toString();
}

/**
 * The filter the page is under, or null when it shows the whole list: then
 * there is nothing to send, because the whole list is what Dash already sees.
 */
export function askListFilter(list: AskListId, params: ListParams): AskListFilter | null {
  const found = entries(list, (key) => {
    const raw = params[key];
    return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  });
  return narrowed(list, found) ? { list, query: queryOf(found) } : null;
}

/** "12 items from Inventory", for the button's sheet to show above the box. */
export function askListLabel(list: AskListId, count: number): string {
  const { one, many, name } = ASK_LISTS[list];
  return `${count} ${count === 1 ? one : many} from ${name}`;
}

const MAX_QUERY = 1000;

/**
 * A filter as it arrives from a browser: a known list, and a query rebuilt
 * from only the params that list reads, so nothing else rides along. Null for
 * anything else, and for a query that narrows nothing.
 */
export function parseAskListFilter(value: unknown): AskListFilter | null {
  if (!value || typeof value !== 'object') return null;
  const { list, query } = value as Record<string, unknown>;
  if (typeof list !== 'string' || !Object.hasOwn(ASK_LISTS, list)) return null;
  if (typeof query !== 'string' || query.length > MAX_QUERY) return null;
  const id = list as AskListId;
  const params = new URLSearchParams(query);
  const found = entries(id, (key) => params.getAll(key));
  return narrowed(id, found) ? { list: id, query: queryOf(found) } : null;
}
