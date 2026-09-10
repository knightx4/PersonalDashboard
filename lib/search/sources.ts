import type { ModuleId } from '@/lib/modules';

/**
 * What a search source is, and what it hands back.
 *
 * The same shape as the agenda's source interface next door and for the same
 * reason: five workspaces own five schemas, a client is bound to exactly one,
 * and PostgREST cannot join across them. So a search is five parallel reads
 * with a merge afterwards, and adding a sixth is one file and one line in the
 * registry.
 *
 * Types only, and no `server-only`, so the palette can hold a SearchHit
 * without pulling a database client into the browser.
 */

/** Every kind of thing that can be found. The label the screen shows. */
export const HIT_KINDS = {
  company: 'Company',
  role: 'Role',
  contact: 'Contact',
  order: 'Order',
  inventory: 'Inventory',
  saved: 'Saved',
  task: 'Todo',
  note: 'Note',
  reading: 'Reading',
  track: 'Track',
  subject: 'Subject',
} as const;

export type HitKind = keyof typeof HIT_KINDS;

/**
 * One thing you own, found.
 *
 * `title` is what was matched against and what is shown; `subtitle` says what
 * it is and where it lives, because "Acme" on its own is a company, an order
 * and a saved item and the palette has to be able to tell you which.
 */
export interface SearchHit {
  module: ModuleId;
  kind: HitKind;
  id: string;
  title: string;
  subtitle: string | null;
  /**
   * Extra words to match on, when the title alone is not how you would look
   * for the thing. A role is called "Staff Engineer" and is looked for by the
   * company it is at, so its source puts the company here.
   *
   * Deliberately not the subtitle. A subtitle says what a thing is -- "Company
   * · Job search" -- and matching against those words means nearly every query
   * matches nearly every row, which is worse than missing a few.
   */
  match?: string;
  /** A route that exists. The palette pushes it on Enter. */
  href: string;
}

export interface SearchContext {
  userId: string;
  /** Trimmed, and never shorter than MIN_QUERY. */
  query: string;
  /** The most this source may return. The merge caps the total again. */
  limit: number;
}

export interface SearchSource {
  id: string;
  /** Which workspace this belongs to. A switched-off one never runs. */
  module: ModuleId;
  /** Named in a log line when it fails, and nowhere else. */
  label: string;
  /**
   * Every kind this source can return. Declared rather than discovered,
   * because a caller that wants only some kinds has to decide whether to run
   * a source before it has seen anything the source would say.
   */
  kinds: readonly HitKind[];
  find(ctx: SearchContext): Promise<SearchHit[]>;
}

/**
 * Two characters. One letter matches most of everything somebody owns, and a
 * palette that fires a five-schema fan-out on "a" is a palette that feels
 * slower the more you have in it.
 */
export const MIN_QUERY = 2;

/** Per source, so one noisy workspace cannot fill the box. */
export const PER_SOURCE_LIMIT = 6;

/** Overall, because the list is a list somebody reads rather than scrolls. */
export const TOTAL_LIMIT = 12;
