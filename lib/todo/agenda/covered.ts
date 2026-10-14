import type { AgendaItem } from '@/lib/todo/agenda/sources';

/**
 * Leaves out an item whose row another listed item `covers` (plan #1937.9),
 * so one ask is listed once, in its most particular form. An item that
 * covers rows itself is never left out by this, so two that cover each
 * other both stay rather than both going.
 *
 * PURE.
 */
export function withoutCovered(items: readonly AgendaItem[]): AgendaItem[] {
  const covered = new Set(items.flatMap((item) => item.covers ?? []));
  if (covered.size === 0) return [...items];
  return items.filter((item) => (item.covers?.length ?? 0) > 0 || !covered.has(item.ref));
}
