import { expandSearchQuery, tokenize } from './search-tags';

export type SearchableInventoryItem = {
  id: string;
  name: string;
  short_name: string | null;
  variant: string | null;
  search_tags: string[] | null;
  category_name?: string | null;
  merchant_name?: string | null;
};

/** Relevance score; higher is better. 0 means no match. */
export function scoreInventoryMatch(
  item: SearchableInventoryItem,
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const terms = expandSearchQuery(q);
  const termSet = new Set(terms);
  const tags = new Set((item.search_tags ?? []).map((t) => t.toLowerCase()));
  const shortName = (item.short_name ?? '').toLowerCase();
  const name = item.name.toLowerCase();
  const variant = (item.variant ?? '').toLowerCase();
  const category = (item.category_name ?? '').toLowerCase();
  const merchant = (item.merchant_name ?? '').toLowerCase();

  let score = 0;

  if (shortName === q || name === q) score += 100;
  if (shortName.includes(q)) score += 40;
  if (name.includes(q)) score += 25;
  if (variant.includes(q)) score += 15;
  if (category.includes(q)) score += 20;
  if (merchant.includes(q)) score += 10;

  let tagHits = 0;
  for (const term of termSet) {
    if (tags.has(term)) tagHits += 1;
  }
  if (tagHits > 0) score += 30 + Math.min(tagHits, 8) * 4;

  // Token overlap on short name for multi-word queries.
  const qTokens = tokenize(q);
  if (qTokens.length > 1) {
    const shortTokens = new Set(tokenize(shortName));
    const hits = qTokens.filter((t) => shortTokens.has(t)).length;
    if (hits === qTokens.length) score += 35;
    else if (hits > 0) score += hits * 8;
  }

  return score;
}

export function filterAndRankBySearch<T extends SearchableInventoryItem>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim();
  if (!q) return items;

  return items
    .map((item) => ({ item, score: scoreInventoryMatch(item, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

/**
 * Build a PostgREST `or` filter for name/short_name/variant/tags.
 * Returns null when there is no query (caller should skip).
 */
export function inventorySearchOrFilter(query: string): string | null {
  const q = query.trim().replace(/[%_,*()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;

  const terms = expandSearchQuery(q);
  const parts: string[] = [
    `name.ilike.%${q}%`,
    `short_name.ilike.%${q}%`,
    `variant.ilike.%${q}%`,
  ];

  // Overlap with expanded tags (PostgREST array literal).
  const tagLiteral = `{${terms
    .slice(0, 24)
    .map((t) => JSON.stringify(t))
    .join(',')}}`;
  parts.push(`search_tags.ov.${tagLiteral}`);

  return parts.join(',');
}
