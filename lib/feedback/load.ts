import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENT_COLUMNS, threadFrom, type DevComment } from '@/lib/comments/load';

/**
 * The feedback queue, loaded and ordered once for both workspaces.
 *
 * There is one queue, not one per workspace: a bug is a bug wherever you were
 * standing when you hit it, and two lists would mean two places to forget
 * something. The shopping and jobs pages differ only in which shell they draw
 * themselves in, so everything above that lives here.
 */

/** Mirrors the `feedback_status` enum. */
export type FeedbackStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'planned'
  | 'done'
  | 'declined';

export type FeedbackRow = {
  id: string;
  kind: 'bug' | 'feature';
  body: string;
  pagePath: string | null;
  status: FeedbackStatus;
  priority: number;
  resolutionNote: string | null;
  commitSha: string | null;
  createdAt: string;
  /** When it closed, done or declined. Null while it is still outstanding. */
  completedAt: string | null;
  /** What has been said under it since it was filed, oldest first. */
  thread: DevComment[];
};

/** Anything not finished — including blocked, the state most easily forgotten. */
export const OUTSTANDING_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'planned',
] as const;

export function isOutstanding(row: FeedbackRow): boolean {
  return (OUTSTANDING_STATUSES as readonly string[]).includes(row.status);
}

/**
 * Same order the notes loop works them in: blocked first because it needs you,
 * then bugs, then priority, then oldest.
 */
const RANK: Record<string, number> = { blocked: 0, in_progress: 1, open: 2, planned: 3 };

export function sortOutstanding(rows: readonly FeedbackRow[]): FeedbackRow[] {
  return [...rows].sort((a, b) => {
    const byStatus = (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    if (a.kind !== b.kind) return a.kind === 'bug' ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export interface FeedbackQueue {
  rows: FeedbackRow[];
  outstanding: FeedbackRow[];
  closed: FeedbackRow[];
  blocked: FeedbackRow[];
}

/** Every column the app reads off a note. Shared with the changelog. */
export const FEEDBACK_COLUMNS =
  'id, kind, body, page_path, status, priority, resolution_note, commit_sha, ' +
  `created_at, completed_at, thread:dev_comments(${COMMENT_COLUMNS})`;

/** A row as the app reads it. One shape leaves here, whoever selected it. */
export function feedbackRowFrom(row: Record<string, unknown>): FeedbackRow {
  return {
    id: row.id as string,
    kind: row.kind as FeedbackRow['kind'],
    body: row.body as string,
    pagePath: (row.page_path as string | null) ?? null,
    status: row.status as FeedbackRow['status'],
    priority: (row.priority as number | null) ?? 2,
    resolutionNote: (row.resolution_note as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
    thread: threadFrom(row.thread),
  };
}

/**
 * Takes a client rather than building one, like everything else in lib/ — the
 * two pages that call this authenticate through different workspaces' helpers,
 * and both end up at the same `public.feedback_items`.
 */
export async function loadFeedbackQueue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<FeedbackQueue> {
  const { data } = await supabase
    .from('feedback_items')
    .select(FEEDBACK_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  // Through `unknown`: the column list is built as an expression, so the client
  // cannot infer a row shape from it and types the result as its error case
  // instead. Same as the ideas loader.
  const rows: FeedbackRow[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(
    feedbackRowFrom,
  );

  const outstanding = sortOutstanding(rows.filter(isOutstanding));

  return {
    rows,
    outstanding,
    closed: rows.filter((row) => !isOutstanding(row)),
    blocked: outstanding.filter((row) => row.status === 'blocked'),
  };
}

/**
 * A note somebody else filed, as the Other users section reads it.
 *
 * Deliberately not a `FeedbackRow`. The row in the table is byte-for-byte the
 * same shape whoever filed it, but #414 settled that another account's note is
 * read-only here -- no status, no priority, no thread, no buttons -- and a
 * type carrying those fields is an invitation to render them.
 */
export type OtherFeedbackRow = {
  id: string;
  /** Who filed it. Null only when the address could not be read. */
  email: string | null;
  kind: 'bug' | 'feature';
  body: string;
  pagePath: string | null;
  createdAt: string;
};

/** What the Other users section reads, which is the note and nothing about working it. */
export const OTHER_FEEDBACK_COLUMNS = 'id, user_id, kind, body, page_path, created_at';

/**
 * The notes the other accounts have filed, newest first.
 *
 * `neq` rather than `eq`, and that is the whole difference from the queue
 * above: every other read in the Dev workspace filters to the signed-in id,
 * which is what kept these rows invisible even before RLS was widened. This
 * one opts out of that filter on purpose, and it is the only read that does.
 *
 * Two round trips, made together. The row carries no email -- `auth.users` is
 * closed to a signed-in session -- so the address comes from
 * `feedback_filer_emails()` (migration 0086), which answers the owner and
 * hands everybody else an empty object. Signed in as anyone but the owner both
 * halves come back empty, because the select policy from 0026 still stands:
 * this returns nothing rather than refusing, and the section simply does not
 * render.
 */
export async function loadOtherUsersFeedback(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<OtherFeedbackRow[]> {
  const [rows, emails] = await Promise.all([
    supabase
      .from('feedback_items')
      .select(OTHER_FEEDBACK_COLUMNS)
      .neq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.rpc('feedback_filer_emails'),
  ]);

  const byUserId = (emails.error ? {} : ((emails.data ?? {}) as Record<string, unknown>)) ?? {};

  return ((rows.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const address = byUserId[row.user_id as string];
    return {
      id: row.id as string,
      email: typeof address === 'string' ? address : null,
      kind: row.kind as OtherFeedbackRow['kind'],
      body: row.body as string,
      pagePath: (row.page_path as string | null) ?? null,
      createdAt: row.created_at as string,
    };
  });
}
