import { escapeLike } from '@/lib/search/sources/map';

/**
 * The pure half of the files search source: what a file is looked for by
 * beyond its title, and the filter that finds it. No `server-only`, so the
 * test can import it.
 */

/** How much of a file's text the palette's held list carries per file. */
export const LIST_TEXT_CHARS = 3000;

/** How much text either side of the first match a server answer carries. */
const SNIPPET_AROUND = 80;

/**
 * An `or` filter matching the title, summary or body, for PostgREST. The
 * pattern is quoted so a comma or bracket in the query is not read as filter
 * syntax, and the backslashes escapeLike adds are doubled for the quotes.
 */
export function fileTextFilter(query: string): string {
  const pattern = `%${escapeLike(query)}%`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return ['title', 'summary', 'body'].map((column) => `${column}.ilike."${pattern}"`).join(',');
}

/** The text around the first place the query appears, or '' when it is nowhere. */
export function snippetAround(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return '';
  const from = Math.max(0, at - SNIPPET_AROUND);
  return text.slice(from, at + query.length + SNIPPET_AROUND).replace(/\s+/g, ' ').trim();
}

/** Summary and body together, as the one run of text a file is searched by. */
export function fileText(summary: string | null, body: string | null, query?: string): string {
  const whole = [summary ?? '', body ?? ''].filter(Boolean).join('\n');
  if (query) return snippetAround(whole, query);
  return whole.slice(0, LIST_TEXT_CHARS);
}
