/**
 * Comments on the rows the dev pages show.
 *
 * One thread shape for an idea, a plan step, a raise and a bug note, because
 * the exchange is the same one wherever it happens: you write something on a
 * row, and a session can write back on the same row. `dev_comments` holds all
 * four (migrations 0062 and 0066), so the type, the column list and the
 * ordering live here rather than four times over in the four loaders.
 *
 * Nothing in here reads the database. The loaders embed `COMMENT_COLUMNS` in
 * their own select and hand the result to `threadFrom`; the CLI, which reads
 * plan rows over a direct connection and asks for no thread, gets an empty one
 * back rather than a crash.
 */

/** Which row a comment is about. */
export const COMMENT_TARGETS = ['idea', 'step', 'raise', 'note'] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

export function isCommentTarget(value: string): value is CommentTarget {
  return (COMMENT_TARGETS as readonly string[]).includes(value);
}

/**
 * The column each target writes. Four nullable foreign keys rather than one
 * generic id, so a deleted row takes its thread with it — see 0062.
 */
export const TARGET_COLUMN: Record<
  CommentTarget,
  'idea_id' | 'plan_item_id' | 'raised_item_id' | 'feedback_item_id'
> = {
  idea: 'idea_id',
  step: 'plan_item_id',
  raise: 'raised_item_id',
  note: 'feedback_item_id',
};

/** The page each target is read on, which is what a write has to revalidate. */
export const TARGET_PATH: Record<CommentTarget, string> = {
  idea: '/dev/ideas',
  step: '/dev/plan',
  raise: '/dev/raised',
  note: '/dev/bugs',
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

/** Every column a thread is read from. Embedded in the target's own select. */
export const COMMENT_COLUMNS = 'id, author, body, created_at';

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
