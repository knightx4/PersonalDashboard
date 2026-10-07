/**
 * The address side of a row of tabs (components/ui/tabs.tsx): which tab a
 * query string opens, and the query string that opens a given tab.
 *
 * A tab lives in the address as `?tab=<id>` so a reload, the back button and
 * a pasted link all land on the same tab. The first tab is the page with no
 * `tab` at all, so the plain address of a page is its first tab and never a
 * second spelling of it. Kept out of the control so a server page can read
 * the same answer the control draws.
 */

/** One tab: its id in the address, the word on it, and an optional count. */
export type Tab = { id: string; label: string; count?: number };

/** The query parameter a tab is kept in. */
export const TAB_PARAM = 'tab';

/**
 * The tab a `?tab=` value opens: that tab when it names one, otherwise the
 * first. An unknown or repeated value opens the first rather than nothing.
 */
export function tabFrom(value: string | readonly string[] | null | undefined, tabs: readonly Tab[]): string {
  const wanted = typeof value === 'string' ? value : undefined;
  const first = tabs[0]?.id ?? '';
  if (!wanted) return first;
  return tabs.some((tab) => tab.id === wanted) ? wanted : first;
}

/**
 * The query string, with its `?`, that opens `id` while keeping every other
 * parameter the page has. Empty when nothing is left, which is the page's
 * own address.
 */
export function tabSearch(search: string, id: string, tabs: readonly Tab[], param = TAB_PARAM): string {
  const params = new URLSearchParams(search);
  if (id === tabs[0]?.id) params.delete(param);
  else params.set(param, id);
  const query = params.toString();
  return query ? `?${query}` : '';
}
