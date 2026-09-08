'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/field';
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
      {/* The shared control, inset for the two glyphs.
        *
        * It drew its own box at its own hand-written height until the sweep,
        * which made it taller than every other field on the page and the one
        * field that could not follow the density dial down. The inset is the
        * only thing this has left to say. */}
      <Input
        type="search"
        value={value}
        onChange={(event) => {
          typing.current = true;
          setValue(event.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8 pr-8"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            typing.current = true;
            setValue('');
          }}
          // Sized to sit inside the field, so smaller than the standard size-8 icon button.
          className="press absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={2} aria-hidden />
          <span className="sr-only">Clear search</span>
        </button>
      )}
    </div>
  );
}
