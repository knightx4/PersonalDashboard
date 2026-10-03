import type { SupabaseClient } from '@supabase/supabase-js';
import { threadFrom, type DevComment } from '@/lib/comments/load';
import { withThreads } from '@/lib/thread/store';
import { triageFrom, type Triage } from '@/lib/feedback/triage';

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

/**
 * Mirrors the `feedback_kind` enum. A like (migration 0106) says something
 * works and should be kept; it is not work, so it sorts after the other two.
 */
export const FEEDBACK_KINDS = ['bug', 'feature', 'like'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** What each kind is called where the person reads it: the tab, the label, the filter. */
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: 'Bug',
  feature: 'Feature',
  like: 'Like',
};

/** A `?kind=` value read off the URL, or null for every kind. */
export function parseFeedbackKind(value: unknown): FeedbackKind | null {
  const first = Array.isArray(value) ? value[0] : value;
  return (FEEDBACK_KINDS as readonly unknown[]).includes(first) ? (first as FeedbackKind) : null;
}

export type FeedbackRow = {
  id: string;
  kind: FeedbackKind;
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
  /** Jev's triage when it was filed (plan #1179); null when it was not triaged. */
  triage?: Triage | null;
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
 * The kinds a notes run works. A like is left out because there is nothing
 * in it to fix: it stays open until the weekly vision review reads it and
 * closes it. Every count that sizes or invites a notes run reads this list,
 * so a like never shows up as work waiting for the routine button.
 */
export const NOTES_WORK_KINDS = ['bug', 'feature'] as const satisfies readonly FeedbackKind[];

export function isNotesWork(row: { kind: FeedbackKind }): boolean {
  return (NOTES_WORK_KINDS as readonly string[]).includes(row.kind);
}

/**
 * Same order the notes loop works them in: blocked first because it needs you,
 * then bugs, then feature requests, then likes, then priority, then oldest.
 */
const RANK: Record<string, number> = { blocked: 0, in_progress: 1, open: 2, planned: 3 };
const KIND_RANK: Record<FeedbackKind, number> = { bug: 0, feature: 1, like: 2 };

export function sortOutstanding(rows: readonly FeedbackRow[]): FeedbackRow[] {
  return [...rows].sort((a, b) => {
    const byStatus = (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    if (a.kind !== b.kind) return (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
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

/** The same queue narrowed to one kind, every list in it at once. Null keeps all of it. */
export function queueOfKind(queue: FeedbackQueue, kind: FeedbackKind | null): FeedbackQueue {
  if (!kind) return queue;
  const of = (rows: FeedbackRow[]) => rows.filter((row) => row.kind === kind);
  return {
    rows: of(queue.rows),
    outstanding: of(queue.outstanding),
    closed: of(queue.closed),
    blocked: of(queue.blocked),
  };
}

/** Every column the app reads off a note. Shared with the changelog. */
export const FEEDBACK_COLUMNS =
  'id, kind, body, page_path, status, priority, resolution_note, commit_sha, triage, ' +
  'created_at, completed_at';

/** The table notes live in, the table half of a note's ref. */
export const FEEDBACK_TABLE = 'public.feedback_items';

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
    triage: triageFrom(row.triage),
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
  // Each note's thread, from the shared store (plan #1470).
  const rows: FeedbackRow[] = (
    await withThreads(supabase, FEEDBACK_TABLE, (data ?? []) as unknown as Array<Record<string, unknown>>, {
      userId,
    })
  ).map(feedbackRowFrom);

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
  kind: FeedbackKind;
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
