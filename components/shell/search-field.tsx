'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/field';
import { otherParams, searchHref, SEARCH_PARAM } from '@/lib/list-search';

/**
 * The box above a list, on every list.
 *
 * There are three kinds of search in the app and they do different things.
 * Cmd-K takes you somewhere: it looks across the modules and its hits are
 * links. A box above a list narrows that list and nothing else, which is this
 * one. A box inside a control -- a merchant picker, a product lookup -- fills
 * in the field it sits in. Anything that narrows a list uses this; the other
 * two are their own controls.
 *
 * The query lives in the URL next to the filters rather than in component
 * state, so a search survives a sort, a filter and the back button, and a
 * narrowed list is a link you can send yourself. Typing is debounced and
 * pushed with `replace`, so a search does not leave one history entry per
 * keystroke between you and the page you came from.
 *
 * It is a real GET form underneath, which is what makes it work before its
 * JavaScript does (law 6): Enter submits, the sr-only button is there for
 * anyone who needs a button, and the cross is a link to the same list without
 * the search. The parameters already on the URL are mirrored as hidden fields
 * because a browser throws away a GET form's query string -- read off the URL,
 * not written out by each page, so a filter cannot be left behind.
 */
export function SearchField({
  placeholder,
  paramName = SEARCH_PARAM,
}: {
  /** What this list matches, e.g. 'Search your notes'. */
  placeholder: string;
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
      typing.current = false;
      router.replace(searchHref(pathname, params, value, paramName), { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, fromUrl, paramName, params, pathname, router]);

  return (
    <form
      action={pathname}
      role="search"
      onSubmit={(event) => {
        // Only reached once React is running; before that this submits itself.
        event.preventDefault();
        typing.current = false;
        router.replace(searchHref(pathname, params, value, paramName), { scroll: false });
      }}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        {/* The shared control, inset for the two glyphs. It draws no box of its
         * own, so it follows the density dial with every other field. */}
        <Input
          type="search"
          name={paramName}
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
          <Link
            href={searchHref(pathname, params, '', paramName)}
            onClick={(event) => {
              event.preventDefault();
              typing.current = true;
              setValue('');
            }}
            // Sized to sit inside the field, so smaller than the standard size-8 icon button.
            className="press absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden />
            <span className="sr-only">Clear search</span>
          </Link>
        )}
      </div>
      {otherParams(params, paramName).map(([key, entry], index) => (
        <input key={`${key}-${index}`} type="hidden" name={key} value={entry} />
      ))}
      <button type="submit" className="sr-only">
        Search
      </button>
    </form>
  );
}
