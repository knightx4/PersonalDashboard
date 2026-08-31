/**
 * Finding one thing on a page that lists everything.
 *
 * The filters answer "show me the ones like this"; a search answers "show me
 * this one". Once a search runs past forty pursuits, scanning the rails for a
 * company you already know the name of is the slow way round.
 *
 * Deliberately plain: case-insensitive substring over the fields a person would
 * type, every term having to match somewhere. No fuzzy matching -- a search
 * that quietly returns near-misses is worse than one that returns nothing,
 * because nothing is a clear answer.
 */

/** Terms, lowercased, with the punctuation people do not type stripped. */
export function searchTerms(query: string | null | undefined): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/[^a-z0-9+#.&/-]/g, ''))
    .filter(Boolean);
}

/**
 * Every term has to appear in at least one of the fields.
 *
 * Per term rather than over the joined string, so "ramp analyst" finds the
 * Ramp analyst role without also needing the words to be adjacent, and without
 * matching a company called "Analyst Ramp Partners" any less.
 */
export function matchesSearch(
  fields: ReadonlyArray<string | null | undefined>,
  terms: readonly string[],
): boolean {
  if (terms.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => Boolean(field))
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
