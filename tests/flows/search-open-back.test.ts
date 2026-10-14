/**
 * Flow: search a goal from a filtered list, open it from the hit, press the
 * goal page's back link, and land on the list as it was: still filtered, and
 * at the offset it was left at (plan #1931.3; docs/ONE-INTERFACE-SPEC.md,
 * Part 2, rule R5).
 *
 * The parts it runs across, each the one the app uses: the goals search
 * source that makes the hit (lib/search/sources/goals-map.ts), the address a
 * hit opens (hitHref, which the search box's run calls in
 * components/shell/use-search-rows.ts), the page header's back link
 * (components/shell/page-header.tsx over components/shell/back-link.tsx,
 * rendered with the hit's address as the router's query), what pressing it
 * does (pressBack), and what the shell does on the path change that follows
 * (arrival, in lib/shell/pane-scroll.ts, which is the scroll restoration of
 * plan #1919.2 that components/shell/app-shell.tsx runs).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goalHits, type GoalItemRow } from '@/lib/search/sources/goals-map';
import { hitHref, pathOf } from '@/lib/core/back-from';
import { arrival, savePaneScroll } from '@/lib/shell/pane-scroll';

/** The address the goal page is rendered at, as the router would hand it over. */
let address = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathOf(address),
  useSearchParams: () => new URLSearchParams(address.split('?')[1] ?? ''),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const { PageHeader } = await import('@/components/shell/page-header');
const { pressBack } = await import('@/components/shell/back-link');

/** sessionStorage, as the shell's offsets and the return mark use it. */
function tab() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const rows: GoalItemRow[] = [
  { id: 'g1', level: 'goal', parent_id: null, status: 'open', kind: null, title: 'Run a marathon' },
  { id: 'g2', level: 'goal', parent_id: null, status: 'open', kind: null, title: 'Pay off the cards' },
];

/** The goal page's path, as rowSubject reads it from the catalogue. */
const goalPath = [
  { label: 'Goals', href: '/goals' },
  { label: 'Health', href: '/goals/area/a1' },
  { label: 'Run a marathon', href: '/goals/g1' },
];

const LIST = '/goals/all';
const FILTERED = '?status=open&q=run';

function backHref(html: string): string | null {
  const m = html.match(/<a[^>]*data-back-link[^>]*>/) ?? html.match(/<a[^>]*href="([^"]*)"[^>]*data-back-link/);
  if (!m) return null;
  const href = m[0].match(/href="([^"]*)"/)?.[1] ?? null;
  return href?.replaceAll('&amp;', '&') ?? null;
}

describe('search a goal, open it, press back', () => {
  beforeEach(() => {
    address = '/';
  });

  it('lands on the list it left, filtered and at the same offset', () => {
    const store = tab();

    // On the filtered list, scrolled down; the shell keeps the offset as the
    // pane scrolls.
    savePaneScroll(LIST, 1240, store);

    // Search for the goal and open it from the hit.
    const [hit] = goalHits(rows, { query: 'marathon', limit: 6 });
    expect(hit?.href).toBe('/goals/g1');
    address = hitHref(hit!.href, { pathname: LIST, search: FILTERED });
    expect(pathOf(address)).toBe('/goals/g1');

    // A link is a push: the goal opens at the top.
    expect(arrival(pathOf(address), false, store).top).toBe(0);

    // The goal page draws one back link, to the list as it was.
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: 'Run a marathon',
        subject: { ref: 'goals.items:g1', path: goalPath },
      }),
    );
    expect(html.match(/data-back-link/g)).toHaveLength(1);
    const back = backHref(html);
    expect(back).toBe(`${LIST}${FILTERED}`);

    // Press it: the list opens filtered, and at the offset it was left at.
    pressBack(back!, store);
    address = back!;
    expect(new URLSearchParams(address.split('?')[1]).get('status')).toBe('open');
    expect(arrival(pathOf(address), false, store)).toEqual({ top: 1240, returned: true });

    // The mark is spent: the next ordinary visit to the list starts at the top.
    expect(arrival(LIST, false, store)).toEqual({ top: 0, returned: false });
  });

  it('goes to the path parent when the goal was opened with no list behind it', () => {
    address = '/goals/g1';
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: 'Run a marathon',
        subject: { ref: 'goals.items:g1', path: goalPath },
      }),
    );
    expect(backHref(html)).toBe('/goals/area/a1');
    expect(html).toContain('Health');
  });

  it('ignores a from that would leave the site', () => {
    for (const from of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      address = `/goals/g1?from=${encodeURIComponent(from)}`;
      const html = renderToStaticMarkup(
        createElement(PageHeader, {
          title: 'Run a marathon',
          subject: { ref: 'goals.items:g1', path: goalPath },
        }),
      );
      expect(backHref(html)).toBe('/goals/area/a1');
    }
  });
});
