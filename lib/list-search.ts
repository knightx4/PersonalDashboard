/**
 * The search a list is narrowed by, and the URL that carries it.
 *
 * The query rides in the URL beside the filters and the sort, the same way
 * `lib/list-display.ts` carries the sort and the grouping, so a narrowed list
 * is a link and every other parameter survives a change of search untouched.
 * Pages used to rebuild that URL by re-declaring each of their own filters as a
 * hidden input inside the search form, which quietly dropped whatever the page
 * had forgotten to list.
 *
 * `otherParams` is the fallback half. A GET form cannot keep a query string in
 * its action — the browser discards it and sends the fields instead — so a form
 * that still has to work before its JavaScript does mirrors the parameters
 * already on the URL as hidden fields. Read off the URL, so there is nothing to
 * forget.
 */

import type { ListSearchParams } from './list-display';

/** The parameter every list in the app searches under. */
export const SEARCH_PARAM = 'q';

/** The URL's parameters, either as a page receives them or as the browser holds them. */
export type SearchParamsInput = URLSearchParams | ListSearchParams;

function entriesOf(params: SearchParamsInput): Array<[string, string]> {
  // Tested by shape rather than by `instanceof`: what `useSearchParams` returns
  // is a subclass, and the page's own parameters are a plain object.
  if (typeof (params as URLSearchParams).entries === 'function') {
    return [...(params as URLSearchParams).entries()];
  }
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    for (const entry of Array.isArray(value) ? value : [value]) pairs.push([key, entry]);
  }
  return pairs;
}

/**
 * Everything on the URL except the search itself, repeats and all. Empty values
 * are dropped, because a parameter set to nothing means the same as one that is
 * not there and only makes two URLs for one view.
 */
export function otherParams(
  params: SearchParamsInput,
  paramName: string = SEARCH_PARAM,
): Array<[string, string]> {
  return entriesOf(params).filter(([key, value]) => key !== paramName && value !== '');
}

/**
 * The same list, searched for something else. An empty query removes the
 * parameter rather than setting it to nothing, so clearing a search goes back
 * to the URL the list had before it.
 */
export function searchHref(
  pathname: string,
  params: SearchParamsInput,
  query: string,
  paramName: string = SEARCH_PARAM,
): string {
  const next = new URLSearchParams();
  const trimmed = query.trim();
  let written = false;

  for (const [key, value] of entriesOf(params)) {
    if (key === paramName) {
      // Replaced where it already sits, so a search changed twice does not
      // shuffle the rest of the URL around it.
      if (!written && trimmed) next.append(key, trimmed);
      written = true;
      continue;
    }
    if (value !== '') next.append(key, value);
  }
  if (!written && trimmed) next.append(paramName, trimmed);

  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
