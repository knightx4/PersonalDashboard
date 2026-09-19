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

export interface SearchListContext {
  userId: string;
  /**
   * The most rows to take from any one table. A read that comes back full
   * means the source is holding back rows the caller will never see, which is
   * what the truncation flag on the whole list is for.
   */
  limit: number;
}

export interface SearchContext extends SearchListContext {
  /** Trimmed, and never shorter than MIN_QUERY. */
  query: string;
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
  /**
   * Everything this source can find, with no query to match against.
   *
   * The palette fetches the whole list once and matches it in the browser, so
   * the same rows have to be reachable without a query. It is the same reads
   * as `find` with the `ilike` left off, which is why both live in one file
   * per source and go through the same mapping.
   */
  list(ctx: SearchListContext): Promise<SearchHit[]>;
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

/**
 * The most rows the one-off list may hold, and the most any one read asks for.
 *
 * An account holds a couple of thousand findable rows today, so this is room
 * to grow into rather than a limit anybody is near. It exists because the
 * browser has to hold the answer: past a few thousand titles and paths the
 * list stops being a few hundred KB, and the palette is better off going back
 * to asking the server per keystroke than to holding a list that big.
 */
export const LIST_LIMIT = 5000;
