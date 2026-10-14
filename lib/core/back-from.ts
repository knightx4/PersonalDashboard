import type { Crumb } from '@/components/shell/breadcrumb';

/**
 * Where a row page's back link goes (plan #1931.3).
 *
 * A row opened from a list carries the list's address in the `from` query,
 * filters and all, so the one back link returns to the list as it was rather
 * than to the list's bare address. A page opened any other way goes back to
 * its path's parent.
 *
 * `from` is read from the address, so anyone can write one into a link. Only
 * a path on this site is taken: one starting with a single `/`, with no
 * scheme, no host and no backslash a browser would read as a slash. Anything
 * else is ignored and the back link goes to the parent, so a crafted link
 * cannot send the person off the site.
 */

export const FROM_PARAM = 'from';

/** The longest `from` taken; a list's address is far shorter. */
const MAX_FROM = 2000;

/** A same-site path to go back to, or null for anything else. */
export function safeFrom(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_FROM) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://here.invalid');
    if (url.origin !== 'https://here.invalid') return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * A list's own address to carry: its path and query, less any `from` it was
 * opened with itself, so a row opened from a row does not carry a chain.
 */
export function listAddress(pathname: string, search: string): string {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  query.delete(FROM_PARAM);
  const rest = query.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** A row's address with the list it was opened from on it. */
export function withFrom(href: string, from: string | null): string {
  const back = safeFrom(from);
  // Only a path on this site takes one; a link elsewhere is left as it is.
  if (!back || !href.startsWith('/') || href.startsWith('//')) return href;
  const hash = href.indexOf('#');
  const base = hash < 0 ? href : href.slice(0, hash);
  const fragment = hash < 0 ? '' : href.slice(hash);
  const mark = base.indexOf('?');
  const path = mark < 0 ? base : base.slice(0, mark);
  // Opening the list you are on from itself carries nothing.
  if (path === pathOf(back)) return href;
  const query = new URLSearchParams(mark < 0 ? '' : base.slice(mark + 1));
  query.set(FROM_PARAM, back);
  return `${path}?${query.toString()}${fragment}`;
}

/**
 * Where a search hit opens: its row, carrying the page the search was made
 * on, so the row's back link returns there as it was.
 */
export function hitHref(href: string, here: { pathname: string; search: string }): string {
  return withFrom(href, listAddress(here.pathname, here.search));
}

/** The path part of an address, without its query or fragment. */
export function pathOf(href: string): string {
  return href.split(/[?#]/)[0] || '/';
}

/**
 * The page's back link: the list named by `from` when there is a good one,
 * labelled with the part of the path it matches, else the fallback (the
 * path's parent, or what the page names). Null draws no link.
 */
export function backTarget(
  from: string | null | undefined,
  crumbs: readonly Crumb[],
  fallback: Crumb | null,
): Crumb | null {
  const back = safeFrom(from);
  if (back) {
    const path = pathOf(back);
    const named = [...crumbs].reverse().find((crumb) => pathOf(crumb.href) === path);
    const label = named?.label ?? (fallback && pathOf(fallback.href) === path ? fallback.label : 'Back');
    return { label, href: back };
  }
  return fallback;
}

/** The path's parent: the part above the last, which is the page itself. */
export function parentCrumb(crumbs: readonly Crumb[]): Crumb | null {
  return crumbs.length >= 2 ? crumbs[crumbs.length - 2]! : null;
}
