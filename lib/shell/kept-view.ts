import { safeFrom } from '@/lib/core/back-from';

/**
 * The last address a list page was showing, so its tab in the column and the
 * dock returns to that view rather than the bare page (note 978314f8).
 *
 * Pipeline keeps its whole view in the address: focus, board or table, the
 * sort, the filters, the page. Its back link already returns there (the
 * `from` query, lib/core/back-from.ts), but the Pipeline tab went to
 * /jobs/pipeline and opened the focus view every time. A tab marked
 * `keepsView` (lib/shell/tabs.ts) links to the address kept here instead.
 *
 * sessionStorage, as pane-scroll.ts: a view is this tab's, for today. Every
 * access is guarded, and without storage the tab goes to the bare page.
 */
const PREFIX = 'kept-view:';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keep `search` as the view `path` is showing. */
export function keepView(path: string, search: string, store: Store | null = browserStore()): void {
  const query = search.startsWith('?') ? search.slice(1) : search;
  try {
    store?.setItem(PREFIX + path, query);
  } catch {
    /* Without it the tab opens the bare page, as it did before. */
  }
}

/** The address a tab to `href` should go to: the view last kept there, or `href`. */
export function keptHref(href: string, store: Store | null = browserStore()): string {
  if (href.includes('?') || href.includes('#')) return href;
  let query: string | null = null;
  try {
    query = store?.getItem(PREFIX + href) ?? null;
  } catch {
    return href;
  }
  if (!query) return href;
  // Only an address on this page is taken, the same check a back link makes.
  return safeFrom(`${href}?${query}`) ?? href;
}
