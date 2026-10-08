/**
 * The address side of a row of tabs (components/ui/tabs.tsx): which tab a
 * query string opens, and the query string that opens a given tab.
 *
 * A tab lives in the address as `?tab=<id>` so a reload, the back button and
 * a pasted link all land on the same tab. The tab a page opens on is the page
 * with no `tab` at all, so the plain address of a page is that tab and never
 * a second spelling of it. Kept out of the control so a server page can read
 * the same answer the control draws.
 */

/**
 * One tab: its id in the address, the word on it, an optional count and an
 * optional icon. The count is drawn beside the label when it is above zero,
 * so something waiting is not hidden behind a tab nobody has opened. An icon
 * is a component, so only a page drawn in the browser can pass one.
 */
export type Tab = {
  id: string;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
};

/** The query parameter a tab is kept in. */
export const TAB_PARAM = 'tab';

/**
 * How one page keeps its tab in the address, for the tabbed sections pattern
 * (components/patterns/tabbed-sections.tsx). Plain data, so a server page can
 * hand it to the strip, which runs in the browser.
 */
export type TabAddress = {
  /** The query parameter, when a page holds two rows of tabs. */
  param?: string;
  /**
   * The tab the page opens on when the address names none: the first, unless
   * the page says otherwise, as the role page does for each stage.
   */
  opensOn?: string;
  /**
   * Write the tab into the address for every tab, the opening one included.
   * For a page whose opening tab changes with what it shows: a pasted link to
   * the role page's Posting tab must still open Posting after the role has
   * moved to a stage that opens on the timeline.
   */
  alwaysWrite?: boolean;
  /** Ids a tab used to go by, to the tab that holds them now, so old links land. */
  former?: Readonly<Record<string, string>>;
  /**
   * Parameters that mean something on one tab only, to that tab. They are
   * dropped from the address on the way to any other tab, as the role page
   * drops the interview to scroll to once you leave Interviews.
   */
  belongsTo?: Readonly<Record<string, string>>;
  /**
   * `#anchors` from before the page had tabs, to the tab that holds them. The
   * browser never sends an anchor to the server, so the strip reads it once it
   * has drawn and moves the address onto that tab, keeping the anchor.
   */
  anchors?: Readonly<Record<string, string>>;
};

type HasId = Pick<Tab, 'id'>;

function addressOf(address: string | TabAddress | undefined): TabAddress {
  return typeof address === 'string' ? { param: address } : (address ?? {});
}

/**
 * The tab a `?tab=` value names, reading a former id as the tab it became, or
 * none when it names no tab here.
 */
export function tabNamed(
  value: string | readonly string[] | null | undefined,
  tabs: readonly HasId[],
  address?: TabAddress,
): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const wanted = address?.former?.[value] ?? value;
  return tabs.some((tab) => tab.id === wanted) ? wanted : undefined;
}

/**
 * The tab a `?tab=` value opens: that tab when it names one, otherwise the
 * one the page opens on (the first, by default). An unknown or repeated value
 * opens that rather than nothing.
 */
export function tabFrom(
  value: string | readonly string[] | null | undefined,
  tabs: readonly HasId[],
  address?: TabAddress,
): string {
  return tabNamed(value, tabs, address) ?? address?.opensOn ?? tabs[0]?.id ?? '';
}

/**
 * The query string, with its `?`, that opens `id` while keeping every other
 * parameter the page has, less the ones that belong to another tab. The
 * opening tab drops the parameter unless the page writes every tab. Empty
 * when nothing is left, which is the page's own address.
 *
 * The last argument is the parameter's name, or the page's whole address.
 */
export function tabSearch(
  search: string,
  id: string,
  tabs: readonly HasId[],
  address: string | TabAddress = TAB_PARAM,
): string {
  const { param = TAB_PARAM, opensOn, alwaysWrite, belongsTo } = addressOf(address);
  const params = new URLSearchParams(search);
  if (!alwaysWrite && id === (opensOn ?? tabs[0]?.id)) params.delete(param);
  else params.set(param, id);
  for (const [key, tab] of Object.entries(belongsTo ?? {})) {
    if (tab !== id) params.delete(key);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * The tab an old `#anchor` link meant, when the address names no tab of its
 * own. A link that names a tab is taken at its word, so this answers nothing.
 */
export function tabForAnchor(
  hash: string,
  search: string,
  tabs: readonly HasId[],
  address?: TabAddress,
): string | undefined {
  const anchor = hash.replace(/^#/, '');
  const target = anchor ? address?.anchors?.[anchor] : undefined;
  if (!target || !tabs.some((tab) => tab.id === target)) return undefined;
  const param = address?.param ?? TAB_PARAM;
  if (tabNamed(new URLSearchParams(search).get(param), tabs, address)) return undefined;
  return target;
}
