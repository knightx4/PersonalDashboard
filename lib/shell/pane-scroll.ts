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

const RETURN_KEY = 'pane-return';

/**
 * The back link (components/shell/back-link.tsx) is a link, not a Back press,
 * but it returns to a list the person was on, so the list should open where
 * they left it (plan #1931.3). It marks the path it is going to here, and the
 * shell's next path change takes the mark and treats the visit as a return.
 */
export function markReturn(path: string, store: Store | null = browserStore()): void {
  try {
    store?.setItem(RETURN_KEY, path);
  } catch {
    /* Without the mark the list opens at the top, as any link does. */
  }
}

/** Whether `path` was marked as a return, clearing the mark either way. */
export function takeReturn(
  path: string,
  store: (Store & Partial<Pick<Storage, 'removeItem'>>) | null = browserStore(),
): boolean {
  try {
    const marked = store?.getItem(RETURN_KEY) ?? null;
    if (marked === null) return false;
    if (store?.removeItem) store.removeItem(RETURN_KEY);
    else store?.setItem(RETURN_KEY, '');
    return marked === path;
  } catch {
    return false;
  }
}

/**
 * What the shell does when the path changes: the offset to open `path` at,
 * and whether the visit was a return by the back link (which, being a push,
 * the browser does not restore below lg on its own).
 */
export function arrival(
  path: string,
  popped: boolean,
  store: (Store & Partial<Pick<Storage, 'removeItem'>>) | null = browserStore(),
): { top: number; returned: boolean } {
  const returned = takeReturn(path, store);
  return { top: openingOffset(path, popped || returned, store), returned };
}
