import { coalesceShortName } from './short-name';
import { buildSearchTags } from './search-tags';

export type DisplayEnrichment = {
  shortName: string;
  searchTags: string[];
};

/** Derive short_name + search_tags for a product line / inventory row. */
export function enrichItemDisplay(input: {
  name: string;
  shortName?: string | null;
  variant?: string | null;
  categorySlug?: string | null;
  categoryName?: string | null;
  searchTags?: readonly string[] | null;
}): DisplayEnrichment {
  const shortName = coalesceShortName(input.name, input.shortName);
  const searchTags = buildSearchTags({
    name: input.name,
    shortName,
    variant: input.variant,
    categorySlug: input.categorySlug,
    categoryName: input.categoryName,
    modelTags: input.searchTags,
  });
  return { shortName, searchTags };
}
