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
