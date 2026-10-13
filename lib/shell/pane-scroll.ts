/**
 * Where the pane was scrolled to on each path, kept for the tab's life so Back
 * lands where the person left (plan #1919.2).
 *
 * sessionStorage, because an offset means nothing in another tab or tomorrow.
 * Every access is guarded: it throws outright where site data is blocked, and
 * the shell then simply starts every page at the top.
 */
const PREFIX = 'pane-scroll:';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePaneScroll(path: string, top: number, store: Store | null = browserStore()): void {
  try {
    store?.setItem(PREFIX + path, String(Math.max(0, Math.round(top))));
  } catch {
    /* Blocked or full storage means Back starts at the top. */
  }
}

export function readPaneScroll(path: string, store: Store | null = browserStore()): number {
  try {
    const n = Number(store?.getItem(PREFIX + path));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * The offset a page opens at: the saved one when the person arrived by Back or
 * Forward (a pop), the top for a link (a push).
 */
export function openingOffset(path: string, popped: boolean, store: Store | null = browserStore()): number {
  return popped ? readPaneScroll(path, store) : 0;
}
