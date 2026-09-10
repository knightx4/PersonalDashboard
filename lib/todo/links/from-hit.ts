import { HIT_KINDS, type HitKind, type SearchHit } from '@/lib/search/sources';
import type { LinkTarget } from '@/lib/todo/links/model';

/**
 * A search hit, as the thing a task can be about.
 *
 * `SearchHit.kind` and `LinkTarget` are two vocabularies over nearly the same
 * set of things. They overlap by word wherever both name the same table, but
 * they are not the same list: the search finds a task, which a task cannot be
 * about, and a task can be about an application or an interview, which the
 * search does not offer because both are reached through their role.
 *
 * So one table, written out in full rather than derived, and a test that fails
 * if a kind is added to HIT_KINDS without an answer here. Pure and client-safe
 * -- the picker runs in the browser and needs the same answer the server
 * writes with.
 */
export const TARGET_FOR_HIT: Record<HitKind, LinkTarget | null> = {
  company: 'company',
  role: 'role',
  contact: 'contact',
  order: 'order',
  inventory: 'inventory',
  saved: 'saved',
  // A task about a task is a subtask, which is a different feature with a
  // different table. task_links has no column for it and should not grow one
  // by accident.
  task: null,
  note: 'note',
  reading: 'reading',
  track: 'track',
  subject: 'subject',
};

/** What a task would point at if it were pointed at this hit. */
export function targetForHit(hit: Pick<SearchHit, 'kind'>): LinkTarget | null {
  return TARGET_FOR_HIT[hit.kind] ?? null;
}

/** Whether a task can point at this hit at all. The picker's filter. */
export function isLinkable(hit: Pick<SearchHit, 'kind'>): boolean {
  return targetForHit(hit) !== null;
}

/** Every kind a task can point at, for whoever is narrowing a search. */
export const LINKABLE_HIT_KINDS: readonly HitKind[] = (
  Object.keys(HIT_KINDS) as HitKind[]
).filter((kind) => TARGET_FOR_HIT[kind] !== null);
