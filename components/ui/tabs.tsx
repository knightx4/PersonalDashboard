'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { TAB_PARAM, tabFrom, tabSearch, type Tab } from '@/lib/tabs';

/**
 * A row of tabs whose every tab is a link (plan #1663).
 *
 * The open tab is read from the address (`?tab=<id>`, lib/tabs.ts), and each
 * tab links to the same page with that one parameter changed, so a reload,
 * the back button and a pasted link land on the tab that was open. The page
 * reads the same parameter with `tabFrom` to decide what to draw beneath.
 * The move does not scroll the page: changing tabs is reading on, not
 * arriving somewhere new.
 *
 * Links rather than an ARIA tablist, because each tab is an address. The open
 * one is `aria-current="page"`. The row stays on one line at every width; a
 * row too long for a phone scrolls inside itself with a fade at the edge,
 * as the role page's did before this was drawn out of it.
 */
export function Tabs({
  tabs,
  label,
  param = TAB_PARAM,
  className,
}: {
  tabs: readonly Tab[];
  /** Names the row for a screen reader, such as "Feature". */
  label: string;
  /** The query parameter, when a page holds two rows of tabs. */
  param?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const active = tabFrom(searchParams.get(param), tabs);

  return (
    <nav
      aria-label={label}
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-border max-lg:scroll-fade-x',
        className,
      )}
    >
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`${pathname}${tabSearch(search, tab.id, tabs, param)}`}
            scroll={false}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'press-area -mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-ui font-medium transition-colors duration-quick',
              on ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="tabular font-normal text-ink-muted">{tab.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
