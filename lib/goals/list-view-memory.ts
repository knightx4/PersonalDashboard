/**
 * The view last chosen for each of a goal's lists (plan #2330.4), kept in
 * this browser's own storage the way a fold is (lib/fold-memory.ts). One
 * entry per list, keyed by the goal and the list's key, so the panel and the
 * list's tab open on the same view.
 *
 * Every access is guarded: where site data is blocked `localStorage` throws,
 * and the cost is only that the list opens on its default view.
 */

const PREFIX = 'goals.list-view';

export function listViewKey(goalId: string, listKey: string): string {
  return `${PREFIX}.${goalId}.${listKey}`;
}

export function readListView(goalId: string, listKey: string): string | null {
  try {
    return window.localStorage.getItem(listViewKey(goalId, listKey));
  } catch {
    return null;
  }
}

export function rememberListView(goalId: string, listKey: string, view: string): void {
  try {
    window.localStorage.setItem(listViewKey(goalId, listKey), view);
  } catch {
    // Storage blocked: the list opens on its default next time.
  }
}
