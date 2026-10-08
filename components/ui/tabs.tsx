'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { TAB_PARAM, tabForAnchor, tabFrom, tabSearch, type Tab, type TabAddress } from '@/lib/tabs';

/**
 * A row of tabs whose every tab is a link (plan #1663), drawn out of the role
 * page's (plan #1593, #1626).
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
 * row too long for a phone scrolls inside itself, running to the screen's
 * edge so the next tab shows cut off there, and
 * the open tab is brought into view along the row when it is not the first,
 * so a page opening on its fifth tab does not hide which one is open.
 *
 * `shallow` is for a page drawn in the browser that already holds every tab's
 * data, as the role page does for its counts: a press writes the address
 * with the history API instead of asking the server for the page again, and
 * what the page holds in state (a half-written form) survives the switch.
 * The tab is still a real link, so it opens in a new window as any other.
 */
export function Tabs({
  tabs,
  label,
  param,
  address,
  shallow = false,
  className,
}: {
  tabs: readonly Tab[];
  /** Names the row for a screen reader, such as "Feature". */
  label: string;
  /** The query parameter, when a page holds two rows of tabs. */
  param?: string;
  /** How the page keeps its tab in the address, when it is not the plain `?tab=`. */
  address?: TabAddress;
  shallow?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const kept: TabAddress = { ...address, param: param ?? address?.param ?? TAB_PARAM };
  const active = tabFrom(searchParams.get(kept.param!), tabs, kept);
  const navRef = useRef<HTMLElement>(null);

  // At phone width the row scrolls, and a page that opens on a later tab
  // would otherwise have its own tab out of sight. Moved along the row only,
  // so the page itself does not move.
  useEffect(() => {
    const nav = navRef.current;
    const open = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !open) return;
    const row = nav.getBoundingClientRect();
    const box = open.getBoundingClientRect();
    if (box.left < row.left || box.right > row.right) {
      nav.scrollLeft += box.left - row.left - 16;
    }
  }, [active]);

  // A link written before the page had tabs points at an anchor; move the
  // address onto the tab that holds it, keeping the anchor to scroll to.
  const anchors = kept.anchors;
  useEffect(() => {
    if (!anchors) return;
    const target = tabForAnchor(window.location.hash, window.location.search, tabs, kept);
    if (!target) return;
    const href = `${pathname}${tabSearch(window.location.search, target, tabs, { ...kept, alwaysWrite: true })}${window.location.hash}`;
    if (!shallow) {
      router.replace(href);
      return;
    }
    window.history.replaceState(null, '', href);
    const id = decodeURIComponent(window.location.hash.slice(1));
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    // Once, on arrival: the anchor is only ever on the address a link opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label={label}
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-border',
        // Below laptop width the row runs on through the page's gutter to
        // the edge of the screen, so a tab that does not fit shows cut off
        // there rather than vanishing, which is what says the row scrolls.
        'max-sm:-mr-4 max-sm:pr-4 sm:max-lg:-mr-6 sm:max-lg:pr-6 max-lg:[mask-image:linear-gradient(to_right,#000_calc(100%-1rem),transparent)]',
        className,
      )}
    >
      {tabs.map((tab) => {
        const on = tab.id === active;
        const href = `${pathname}${tabSearch(search, tab.id, tabs, kept)}`;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={href}
            scroll={false}
            onClick={
              shallow
                ? (event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    if (!on) window.history.pushState(null, '', href);
                  }
                : undefined
            }
            aria-current={on ? 'page' : undefined}
            className={cn(
              'press-area -mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-ui font-medium transition-colors duration-quick',
              on ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {Icon && <Icon className="size-4" strokeWidth={1.75} aria-hidden />}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="tabular font-normal text-ink-muted">
                {tab.count}
                {tab.countNoun && ` ${tab.countNoun}`}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
