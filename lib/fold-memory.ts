/**
 * Which folds you left shut, or left open, per browser (plan #1432).
 *
 * Every titled box that folds can be given a key, and the way you left it is
 * kept under that key in this browser's own storage, the same place the vault
 * keeps its open folders (lib/vault/open-folders.ts). One entry per box rather
 * than one list for the app, so the key the jobs page already wrote for its
 * recommendations (`jobs.fold.Recommended roles`, `'1'` while folded) carries
 * over unchanged.
 *
 * Only a fold that differs from the box's own default is stored. A box left
 * the way it opens costs nothing, and a box whose default changes later (a
 * pipeline column that fills up and so opens by default) is not held to a
 * choice that only matched the old default.
 *
 * Every access is guarded: where site data is blocked `localStorage` throws on
 * the way in, and the cost of that is only that the box opens its usual way.
 */

/** `true` folded, `false` open, `null` nothing kept (or storage unreadable). */
export function readFold(key: string): boolean | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Record how a box was left. `defaultOpen` is how the box opens when nothing
 * is kept, so leaving it that way clears the entry instead of writing one.
 */
export function rememberFold(key: string, open: boolean, defaultOpen: boolean): void {
  try {
    if (open === defaultOpen) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, open ? '0' : '1');
  } catch {
    /* Storage blocked: the fold lasts until the page is left. */
  }
}

/** Whether the box should be open, given its default and what was kept. */
export function openFor(defaultOpen: boolean, kept: boolean | null): boolean {
  return kept === null ? defaultOpen : !kept;
}
