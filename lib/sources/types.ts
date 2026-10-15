/**
 * What a module tells Goals about its tables (docs/GOALS-SPEC.md, "Pulling
 * in from the other modules").
 *
 * Every table in the schemas the app owns is either a source, which Claude
 * may search when it maps a goal or plans an area, or a table that is not
 * one, with the reason. Each module declares both in a `sources.ts` beside its
 * own code, and lib/sources/catalogue.ts gathers them. The gate refuses a
 * table that is in neither list (tests/sources-catalogue.test.ts), so a new
 * table cannot land without someone deciding which it is.
 */

/**
 * How much a source says about what the person wants, which decides the order
 * Claude reads them in.
 *
 * - `intent`: written on purpose to say what they want or think. A job
 *   search thoughts entry, a vault note, an area's note. Read first, and
 *   quoted rather than paraphrased.
 * - `record`: what they did or have. Applications, readings, tasks. Read for
 *   progress and for facts to fill a goal's collections.
 * - `incidental`: mentions, not statements. A newsletter story, an event on
 *   a calendar feed. Read last, and only as a lead.
 */
export type SourceWeight = 'intent' | 'record' | 'incidental';

export const SOURCE_WEIGHTS: readonly SourceWeight[] = ['intent', 'record', 'incidental'];

export type Source = {
  /** `schema.table`. */
  table: string;
  /** The module it belongs to, as the page names it. */
  module: string;
  /** One sentence: what a row holds, in the person's terms. */
  holds: string;
  weight: SourceWeight;
  /** The text or jsonb columns worth searching. */
  search: readonly string[];
  /** The column that names a row in a list. */
  title: string;
  /**
   * Where a better name for a row is kept on another table, when `title` is
   * only a key: a PostgREST embed of a foreign key and the column read from
   * it. A watch list row is named by its video's title on catalogue_items.
   * Dash's list_rows reads it (lib/ask/list-rows.ts).
   */
  titleVia?: { embed: string; column: string };
  /**
   * Columns read beside `search` that are not text to search: dates, flags,
   * numbers that say what happened to a row, such as when a video was watched.
   */
  facts?: readonly string[];
  /** The column that orders rows newest first; `created_at` when absent. */
  newest?: string;
  /** The column a link to one row stores; `id` unless the table says otherwise. */
  ref?: string;
  /**
   * How a row is tied to its owner, when it is not a `user_id` column: a
   * column name, or a sentence naming the join.
   */
  owner?: string;
  /** Where one row opens in the app, from its ref. Absent when it has no page. */
  href?: (ref: string) => string;
  /**
   * The section of the nav a row's page sits under, for a source whose page
   * is worked out from `href` (see Page.section). Required whenever `href` is
   * set and `page` is not; the catalogue refuses one without it.
   */
  section?: Section | null;
  /** How to find the row above this one in the path (see Page.parent). */
  parent?: Parent;
  /** Anything else Claude should know to read it well. */
  note?: string;
  /**
   * Where one row opens when it is named by a ref (lib/core/refs.ts). Left
   * out, it is worked out from `href`, `title` and `ref` above; null when
   * the table has an href for Goals but its rows cannot be named by id.
   */
  page?: Page | null;
};

export type NotASource = {
  /** `schema.table`. */
  table: string;
  /** Why Goals never reads it, in a few words. */
  reason: string;
  /**
   * Where one row opens when it is named by a ref (lib/core/refs.ts), for a
   * table Goals does not read that still has a page.
   */
  page?: Page;
};

/** One row as a page entry reads it: `id`, the title's columns and `reads`. */
export type PageRow = Readonly<Record<string, unknown>>;

/**
 * How a row named by a ref (`schema.table:id`, docs/CORE-AND-DASH-SPEC.md
 * Part 1) is opened and named. Every table a person can open a page for has
 * one, whether or not Goals may read it; being a source still means only
 * that. A ref always names a row by its `id` column.
 */
export type Page = {
  /** The column that names a row, or how to name it from the columns it reads. */
  title: string | { reads: readonly string[]; of: (row: PageRow) => string | null };
  /** The page one row opens on; null for a row of this table with no page. */
  href: (row: PageRow) => string | null;
  /**
   * The columns `href` reads besides `id`. Empty or absent means the id
   * alone gives the page, so refHref needs no query.
   */
  reads?: readonly string[];
  /**
   * The section of the workspace's nav a row's page sits under, which is the
   * second part of its path (refPath in lib/core/refs.ts): Pipeline for a
   * role, Plan for a plan step. Null for a row that sits under another row
   * rather than a section of its own, such as a file under the step it was
   * written for: its path takes the section of the row above it.
   */
  section: Section | null;
  /** How to find the row this one sits under, when it sits under one. */
  parent?: Parent;
  /**
   * The path walks past rows of this table without naming them. An
   * application stands between an interview and its role, and the role is
   * what a person knows it by.
   */
  passThrough?: true;
};

/**
 * One section of a workspace's nav: the tab's address and its name, as the
 * workspace's layout writes them (app/<workspace>/layout.tsx), or the
 * workspace's settings page. lib/sources/catalogue.test.ts holds each one to
 * its layout.
 */
export type Section = { href: string; label: string };

/**
 * How a row names the row it sits under: a goal step its goal, a role its
 * company, a plan step its feature. `ref` reads the columns in `reads` and
 * gives the parent's ref (`schema.table:id`), or null when this row has none.
 */
export type Parent = {
  reads: readonly string[];
  ref: (row: PageRow) => string | null;
  /**
   * The foreign keys `ref` follows, in the order it tries them: each column
   * and the table whose `id` it names. Set by parentBy and parentByFirst, so
   * a lookup can follow the link from either end without a row in hand (a
   * cover letter to its application, or an application to its cover
   * letters). Absent for a parent read from something other than a key,
   * such as a ref column.
   */
  links?: readonly ParentLink[];
};

/** One foreign key a parent follows: `column` names a row of `table` by its id. */
export type ParentLink = { column: string; table: string };

/**
 * The usual parent: a foreign key column naming a row of `table` by its id,
 * as `parentBy('company_id', 'job_search.companies')` for a role.
 */
export function parentBy(column: string, table: string): Parent {
  return parentByFirst([column, table]);
}

/**
 * A parent that is the first of several foreign keys set on the row, for a
 * row that may hang off one of a few things: a job search note under its
 * interview, else its application, else its role.
 */
export function parentByFirst(...keys: readonly (readonly [column: string, table: string])[]): Parent {
  const links = keys.map(([column, table]) => ({ column, table }));
  return {
    reads: links.map((l) => l.column),
    links,
    ref: (row) => {
      for (const { column, table } of links) {
        const id = row[column];
        if (typeof id === 'string' && id) return `${table}:${id}`;
      }
      return null;
    },
  };
}

export type ModuleSources = {
  sources: readonly Source[];
  notSources: readonly NotASource[];
};
