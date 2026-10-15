import { useSyncExternalStore } from 'react';

/**
 * Whether a link to another page is waiting on the server.
 *
 * A route's loading.tsx shows at once only when the link's prefetch has
 * landed. Otherwise the router waits for the server's first reply before it
 * can draw anything, and on a cold function, or behind the thirty prefetches a
 * subject page fires, that took seconds with nothing but a dimmed link to show
 * for it. LinkPending reports here while its link is pending, and the shell
 * puts a loading screen up in place of the page (PendingPage), so a click
 * always answers straight away.
 */

let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Mark one navigation as waiting. Call the returned function when it stops. */
export function holdNavigation(): () => void {
  pending += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pending -= 1;
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while any link to another page is waiting on the server. */
export function useNavigationPending(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending > 0,
    () => false,
  );
}

/**
 * The path a link goes to, or null when it cannot be told. A link that only
 * changes the query or the hash stays on its page, which keeps showing while
 * it updates.
 */
export function linkPathname(href: unknown): string | null {
  if (typeof href === 'string') {
    if (href.startsWith('#') || href.startsWith('?')) return null;
    try {
      return new URL(href, 'http://x').pathname;
    } catch {
      return null;
    }
  }
  if (href && typeof href === 'object' && 'pathname' in href) {
    const pathname = (href as { pathname?: unknown }).pathname;
    return typeof pathname === 'string' ? pathname : null;
  }
  return null;
}
