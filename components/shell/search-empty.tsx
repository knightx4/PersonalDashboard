'use client';

import { SearchX } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { usePathname, useSearchParams } from 'next/navigation';
import { otherParams, searchHref, SEARCH_PARAM } from '@/lib/list-search';

/**
 * What a list says when a search matched nothing.
 *
 * Nothing matching is the same event on the vault as on the orders page, so it
 * reads the same on both: that nothing matched, what was searched for, and a
 * way back. Every list wrote its own until this, and the wordings drifted --
 * the vault named the vault, todo named the status filter, inventory fell back
 * to a sentence about filters that did not mention the search at all.
 *
 * The way back clears the search and nothing else. It is built from the URL the
 * page is on, through the same helper the search box uses (`lib/list-search`),
 * so the date range, the sort and the grouping survive it. The links the pages
 * wrote by hand pointed at the bare list and dropped all three.
 */
export function SearchEmpty({
  query,
  paramName = SEARCH_PARAM,
  className,
}: {
  /** What was searched for, as the page read it off the URL. */
  query: string;
  paramName?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  // Said only when there is something to keep. On a list with nothing but a
  // search on it, a promise to keep the rest is a sentence about nothing.
  const narrowed = otherParams(params, paramName).length > 0;

  return (
    <EmptyState
      icon={SearchX}
      title="Nothing matched"
      description={
        narrowed
          ? `Nothing on this list matches “${query}”. Clearing the search keeps everything else you had set.`
          : `Nothing on this list matches “${query}”.`
      }
      action={{ label: 'Clear the search', href: searchHref(pathname, params, '', paramName) }}
      className={className}
    />
  );
}
