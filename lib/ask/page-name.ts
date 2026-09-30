import { MODULES } from '@/lib/modules';

/**
 * What the Ask Dash sheet can say about an address before the server has
 * read it (plan #1272), and the path rule both sides share. Nothing here
 * reads the database or the catalogue, so the sheet can import it.
 */

/** The path of an address, without its query, fragment or trailing slash. */
export function pathOf(address: string): string {
  let path = address.split(/[?#]/)[0] || '/';
  try {
    // A full URL, as the sheet might pass location.href.
    if (/^https?:\/\//.test(path)) path = new URL(path).pathname;
  } catch {
    // Not a URL after all; read it as a path.
  }
  if (!path.startsWith('/')) path = `/${path}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The Ask page carries on earlier questions, so being on it tells Dash nothing. */
export function isAskPath(address: string): boolean {
  const path = pathOf(address);
  return path === '/ask' || path.startsWith('/ask/');
}

/**
 * A short name for the page while its row is being read, or when it could
 * not be: the workspace ("Learn"), or the first part of the address outside
 * one ("Account"). Never the rest of the address, which may be an id.
 */
export function roughPageName(address: string): string {
  const path = pathOf(address);
  const workspace = MODULES.find((m) => path === m.prefix || path.startsWith(`${m.prefix}/`));
  if (workspace) return workspace.label;
  const first = path.split('/').filter(Boolean)[0];
  if (!first) return 'Home';
  let word = first;
  try {
    word = decodeURIComponent(first);
  } catch {
    // Keep it as written.
  }
  word = word.replace(/[-_]+/g, ' ').trim();
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : 'Home';
}
