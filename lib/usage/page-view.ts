import { moduleForPath, type ModuleId } from '@/lib/modules';
import { PAGE_ROUTES } from '@/lib/usage/pages';

/**
 * Which requests count as opening a page, and what is recorded for one
 * (plan #1481, docs/CUT-BACK-SPEC.md part 1). proxy.ts calls pageView() on
 * every request it lets through and writes a core.page_views row for each
 * one that comes back.
 *
 * Kept free of Next and Supabase imports so the rules can be tested on plain
 * values.
 */

/** 'load' is a full document request; 'navigation' is a client-side move. */
export type PageViewVia = 'load' | 'navigation';

export type PageView = { route: string; workspace: ModuleId | null; via: PageViewVia };

/** The parts of a request the rules read. */
export type PageRequest = {
  method: string;
  pathname: string;
  headers: { get(name: string): string | null };
};

type Segment = { kind: 'static'; name: string } | { kind: 'dynamic' } | { kind: 'catchAll'; optional: boolean };

function parse(route: string): Segment[] {
  return route
    .split('/')
    .filter(Boolean)
    .map((part): Segment => {
      if (part.startsWith('[[...')) return { kind: 'catchAll', optional: true };
      if (part.startsWith('[...')) return { kind: 'catchAll', optional: false };
      if (part.startsWith('[')) return { kind: 'dynamic' };
      return { kind: 'static', name: part };
    });
}

const PATTERNS = PAGE_ROUTES.map((route) => ({ route, segments: parse(route) }));

const RANK = { static: 2, dynamic: 1, catchAll: 0 } as const;

/** The rank of each segment a pattern matched with, or null when it does not match. */
function matchRanks(segments: Segment[], parts: string[]): number[] | null {
  const ranks: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.kind === 'catchAll') {
      const rest = parts.length - i;
      if (rest < (segment.optional ? 0 : 1)) return null;
      ranks.push(RANK.catchAll);
      return ranks;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (segment.kind === 'static' && segment.name !== part) return null;
    ranks.push(RANK[segment.kind]);
  }
  return parts.length === segments.length ? ranks : null;
}

/** Earlier segments decide first, as Next does: a static segment beats a dynamic one. */
function beats(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * The page a path opens, as its route pattern with the ids replaced:
 * `/learn/s/6f1c…` is `/learn/s/[id]`. Null for anything that is not one of
 * the app's pages: route handlers, static files, a path that would 404.
 */
export function routePattern(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  let best: { route: string; ranks: number[] } | null = null;
  for (const pattern of PATTERNS) {
    const ranks = matchRanks(pattern.segments, parts);
    if (ranks && (!best || beats(ranks, best.ranks))) best = { route: pattern.route, ranks };
  }
  return best?.route ?? null;
}

/**
 * How a request opened a page, or null when it did not open one.
 *
 * A client navigation arrives as an RSC request (`rsc: 1`) and a prefetch as
 * the same request with `next-router-prefetch` set, which is the only thing
 * that tells the two apart. Server actions are POSTs and are not counted;
 * nor is anything under /api or /_next.
 */
export function pageViewVia(request: PageRequest): PageViewVia | null {
  if (request.method !== 'GET') return null;
  if (request.pathname.startsWith('/api/') || request.pathname.startsWith('/_next/')) return null;

  const header = (name: string) => request.headers.get(name);
  if (header('next-router-prefetch') !== null || header('next-router-segment-prefetch') !== null) return null;
  // The browser's own prefetch of a <link rel=prefetch>, which nobody opened.
  if (/prefetch/i.test(header('sec-purpose') ?? header('purpose') ?? '')) return null;
  if (header('next-action') !== null) return null;

  if (header('rsc') === '1') return 'navigation';

  const dest = header('sec-fetch-dest');
  if (dest !== null) return dest === 'document' ? 'load' : null;
  return (header('accept') ?? '').includes('text/html') ? 'load' : null;
}

/** What to record for a request, or null when it did not open a page. */
export function pageView(request: PageRequest): PageView | null {
  const via = pageViewVia(request);
  if (!via) return null;
  const route = routePattern(request.pathname);
  if (!route) return null;
  return { route, workspace: moduleForPath(route), via };
}
