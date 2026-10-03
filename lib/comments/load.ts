/**
 * Comments on the rows the dev pages show.
 *
 * One thread shape for an idea, a plan step, a raise, a bug note and a section
 * of a specification, because the exchange is the same one wherever it happens:
 * you write something on a row, and a session can write back on the same row.
 * Every thread is kept in core.conversations under the row's ref (plan #1470;
 * lib/thread/store.ts), so the type and the ordering live here rather than
 * over again in each loader.
 *
 * Nothing in here reads the database. The loaders set `thread` on each row
 * from the shared store and hand it to `threadFrom`; the CLI, which reads plan
 * rows over a direct connection and asks for no thread, gets an empty one back
 * rather than a crash.
 */

/** Which row a comment is about. */
export const COMMENT_TARGETS = ['idea', 'step', 'raise', 'note', 'spec', 'takeaway', 'change'] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

export function isCommentTarget(value: string): value is CommentTarget {
  return (COMMENT_TARGETS as readonly string[]).includes(value);
}

/**
 * The column each target wrote in public.dev_comments, read-only since plan
 * #1470. The conversations list still folds turns by it.
 */
export const TARGET_COLUMN: Record<
  CommentTarget,
  | 'idea_id'
  | 'plan_item_id'
  | 'raised_item_id'
  | 'feedback_item_id'
  | 'spec_section_id'
  | 'inspiration_takeaway_id'
  | 'spec_change_id'
> = {
  idea: 'idea_id',
  step: 'plan_item_id',
  raise: 'raised_item_id',
  note: 'feedback_item_id',
  spec: 'spec_section_id',
  // An inspiration takeaway (notes c934aefe and eef7e9f1, migration 0149).
  takeaway: 'inspiration_takeaway_id',
  // A proposed change to a spec (plan #1507, migration 0156).
  change: 'spec_change_id',
};

/** The page each target is read on, which is what a write has to revalidate. */
export const TARGET_PATH: Record<CommentTarget, string> = {
  idea: '/dev/ideas',
  step: '/dev/plan',
  raise: '/dev/raised',
  note: '/dev/bugs',
  // The list, not the document. A comment is written on one spec's page, and
  // that page's own path is not knowable from the target alone -- the write
  // revalidates the index, and the document's page is revalidated by the action
  // that knows which one it was.
  spec: '/dev/specs',
  takeaway: '/dev/inspiration',
  change: '/dev/specs',
};

/**
 * The page that lists every conversation, whichever row it was started on.
 *
 * A comment written or deleted anywhere changes that list as well as the row's
 * own page, so both are redrawn. Without it a reply written from the list is
 * gone again the moment the optimistic row clears.
 */
export const CONVERSATIONS_PATH = '/dev/raised';

/**
 * Who wrote it. 'me' is you on the page, 'claude' is a session — both write
 * with your account, so the column is what tells the two halves of the
 * conversation apart.
 */
export type CommentAuthor = 'me' | 'claude';

export type DevComment = {
  id: string;
  author: CommentAuthor;
  body: string;
  createdAt: string;
};

/**
 * Oldest first, so the thread reads downwards. Sorted here rather than in the
 * query: an embedded select carries no order of its own, and the alternative
 * is a second round trip for something that is never more than a handful of
 * rows.
 */
export function threadFrom(value: unknown): DevComment[] {
  if (!Array.isArray(value)) return [];
  return (value as Array<Record<string, unknown>>)
    .map((row) => ({
      id: row.id as string,
      author: row.author === 'claude' ? ('claude' as const) : ('me' as const),
      body: row.body as string,
      createdAt: String(row.created_at ?? ''),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
