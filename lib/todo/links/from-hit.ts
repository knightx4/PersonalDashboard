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
  // A task sits under another task through todo.tasks.parent_id, not through
  // a link. What a task is ABOUT and what it sits UNDER are different
  // relations -- the first points out of the module, the second is the module
  // holding one of its own rows -- so task_links has no column for this and
  // should not grow one by accident.
  task: null,
  note: 'note',
  reading: 'reading',
  track: 'track',
  subject: 'subject',
  // The Dev workspace is about the app rather than about your life, and a
  // task pointing into the build plan has no column to live in.
  plan: null,
  spec: null,
  idea: null,
  feedback: null,
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
