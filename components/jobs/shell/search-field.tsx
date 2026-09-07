'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Search on the list pages.
 *
 * The query lives in the URL next to the filters rather than in component
 * state, so a search survives a sort, a filter and the back button, and a
 * narrowed list is a link you can send yourself.
 *
 * Typing is debounced and pushed with `replace`, so a search does not leave one
 * history entry per keystroke between you and the page you came from.
 */
export function SearchField({
  placeholder = 'Search company or role',
  paramName = 'q',
}: {
  placeholder?: string;
  paramName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromUrl = params.get(paramName) ?? '';

  const [value, setValue] = useState(fromUrl);
  // A search cleared from elsewhere -- a rail link that drops the query, the
  // back button -- has to be reflected here, but not while it is being typed.
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setValue(fromUrl);
  }, [fromUrl]);

  useEffect(() => {
    if (value === fromUrl) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set(paramName, value.trim());
      else next.delete(paramName);
      const query = next.toString();
      typing.current = false;
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, fromUrl, paramName, params, pathname, router]);

  return (
    // A fixed width, not `w-full`: this sits in a shrink-to-fit flex row beside
    // the page's primary action, where a percentage width collapses to nothing.
    <div className="relative w-40 sm:w-64">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => {
          typing.current = true;
          setValue(event.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-8 text-base text-ink placeholder:text-ink-ghost focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-ui"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            typing.current = true;
            setValue('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-muted hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={2} aria-hidden />
          <span className="sr-only">Clear search</span>
        </button>
      )}
    </div>
  );
}
