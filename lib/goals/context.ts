/**
 * Context on a goal (docs/GOALS-SPEC.md, "Pulling in from the other
 * modules"): what another module holds that bears on it, found by Claude from
 * the catalogue in lib/sources and kept or dismissed by you.
 *
 * Pure: the store in context-store.ts reads and writes goals.context, and
 * this file says what a row means on the page.
 */
import { sourceFor, sourceHref, sourceModule } from '@/lib/sources/catalogue';
import { SOURCE_WEIGHTS, type SourceWeight } from '@/lib/sources/types';

export type ContextStatus = 'proposed' | 'kept' | 'dismissed';

export type ContextItem = {
  id: string;
  /** `schema.table`, as the catalogue names it. */
  source: string;
  ref: string;
  title: string;
  why: string;
  excerpt: string | null;
  status: ContextStatus;
  /** The module it lives in, as the page names it. */
  module: string;
  /** Where it opens in its module, or null when it has no page. */
  href: string | null;
  /** How much it says about what the person wants; `record` for a table the catalogue no longer lists. */
  weight: SourceWeight;
};

export type ContextRow = {
  id: string;
  source: string;
  ref: string;
  title: string;
  why: string;
  excerpt: string | null;
  status: string;
};

export const CONTEXT_COLUMNS = 'id, source, ref, title, why, excerpt, status';

function isStatus(value: string): value is ContextStatus {
  return value === 'proposed' || value === 'kept' || value === 'dismissed';
}

export function toContextItem(row: ContextRow): ContextItem {
  return {
    id: row.id,
    source: row.source,
    ref: row.ref,
    title: row.title,
    why: row.why,
    excerpt: row.excerpt,
    status: isStatus(row.status) ? row.status : 'proposed',
    module: sourceModule(row.source),
    href: sourceHref(row.source, row.ref),
    weight: sourceFor(row.source)?.weight ?? 'record',
  };
}

/**
 * What the page shows: dismissed rows left out, what the person said they
 * want before what they did, and within each, proposals first so they are
 * seen and settled.
 */
export function shownContext(items: readonly ContextItem[]): ContextItem[] {
  const weightRank = (w: SourceWeight) => SOURCE_WEIGHTS.indexOf(w);
  return items
    .filter((item) => item.status !== 'dismissed')
    .sort(
      (a, b) =>
        weightRank(a.weight) - weightRank(b.weight) ||
        Number(b.status === 'proposed') - Number(a.status === 'proposed') ||
        a.module.localeCompare(b.module) ||
        a.title.localeCompare(b.title),
    );
}

/** The first line of a title, short enough for one row. */
export function contextTitle(title: string, max = 120): string {
  const line = title.trim().split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
