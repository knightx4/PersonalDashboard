/**
 * Barcode → product name.
 *
 * UPCitemdb's trial endpoint is keyless and rate-limited; a paid key raises
 * the ceiling. Deliberately generic — it names the product behind any retail
 * barcode, and the category resolvers take it from there.
 */
import { getJson } from '@/lib/books/providers/http';

export type ProductHit = {
  ean13: string;
  title: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
};

type UpcItemDbResponse = {
  code?: string;
  total?: number;
  items?: {
    ean?: string;
    upc?: string;
    title?: string;
    brand?: string;
    category?: string;
    images?: string[];
  }[];
};

export type UpcLookupOptions = {
  fetch?: typeof globalThis.fetch;
  /** Paid key; the trial endpoint is used when absent. */
  apiKey?: string | null;
  baseUrl?: string;
};

export function createUpcLookup(options: UpcLookupOptions = {}) {
  const baseUrl =
    options.baseUrl ??
    (options.apiKey
      ? 'https://api.upcitemdb.com/prod/v1'
      : 'https://api.upcitemdb.com/prod/trial');

  return {
    async lookup(ean13: string): Promise<ProductHit | null> {
      const data = await getJson<UpcItemDbResponse>(
        `${baseUrl}/lookup?upc=${encodeURIComponent(ean13)}`,
        {
          provider: 'upc_lookup',
          fetch: options.fetch,
          headers: options.apiKey
            ? { user_key: options.apiKey, key_type: '3scale' }
            : undefined,
        },
      );
      const item = data?.items?.[0];
      if (!item?.title?.trim()) return null;
      return {
        ean13,
        title: item.title.trim(),
        brand: item.brand?.trim() || null,
        category: item.category?.trim() || null,
        imageUrl: item.images?.[0]?.trim() || null,
      };
    },
  };
}
