'use client';

import { SearchBar } from '@/components/shell/search-bar';

/**
 * The top bar's search field in the surface gallery. The bar takes an
 * onOpen handler, which a server render cannot pass, so the gallery entry
 * renders it from here with one that does nothing.
 */
export function SearchBarSurface() {
  return <SearchBar onOpen={() => {}} module="jobs" />;
}
