import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COMMENT_TARGETS,
  TARGET_COLUMN,
  TARGET_PATH,
  isCommentTarget,
  threadFrom,
  type CommentAuthor,
  type CommentTarget,
  type DevComment,
} from './load';
import { threadSubject } from '@/lib/thread/subjects';

/**
 * Every conversation on the account, wherever it was started.
 *
 * A thread is only visible from the row it lives on, so an answer written
 * overnight is found by remembering which idea, step, raise or note the
 * question was asked on. Every thread on a dev row is in core.conversations
 * under the row's ref (plan #1470), so one read of the turns has the lot, and
 * one more per kind of row names them; they are folded into one conversation
 * per row.
 *
 * The fold is pure and the loader beside it takes a client, the same shape
 * lib/digest/load.ts has. Nothing here caps the list — the page decides how
 * many lines it draws.
 */

export type Conversation = {
  /** Which kind of row it is about, and what a reply is written against. */
  target: CommentTarget;
  /** The row being talked about, not the comment. */
  rowId: string;
  /** What it is about, in one line. */
  about: string;
  /** The page the row is shown on. */
  href: string;
  /** The whole thread, oldest first. */
  thread: DevComment[];
  /** When the last message was written. */
  lastAt: string;
  /** Who wrote it. A conversation Dash spoke last in is one you may not have read. */
  lastAuthor: CommentAuthor;
  /** Dash has written in it since you last opened it. */
  unread: boolean;
};

/** When each conversation was last opened, by `conversationKey`. */
export type ConversationReads = ReadonlyMap<string, string>;

/** One conversation is one row, so the key is the two columns that name it. */
export function conversationKey(target: CommentTarget, rowId: string): string {
  return `${target}:${rowId}`;
}

/** The read marks, as the fold wants them. `dev_comment_reads`, one row each. */
export function readsFrom(rows: readonly Record<string, unknown>[]): Map<string, string> {
  const reads = new Map<string, string>();
  for (const row of rows) {
    const target = String(row.target ?? '');
    const rowId = String(row.row_id ?? '');
    if (!isCommentTarget(target) || !rowId) continue;
    reads.set(conversationKey(target, rowId), String(row.read_at ?? ''));
  }
  return reads;
}

/**
 * Whether the mark is on.
 *
 * Only Dash's last word can leave one: a thread you spoke last in is one you
 * have obviously read, whatever the marks say. Never having opened it counts
 * as not having read it, which is the case the whole thing is for -- an answer
 * written overnight on a row you have not been back to. Compared as instants
 * rather than as strings, because the two dates come from different columns
 * and Postgres is free to render an offset either way.
 */
export function isUnread(
  lastAuthor: CommentAuthor,
  lastAt: string,
  readAt: string | undefined,
): boolean {
  if (lastAuthor !== 'claude') return false;
  if (!readAt) return true;
  const read = Date.parse(readAt);
  const last = Date.parse(lastAt);
  if (Number.isNaN(read) || Number.isNaN(last)) return true;
  return read < last;
}

/** Long enough to tell two rows apart, short enough to sit on one line. */
const ONE_LINE = 80;

function firstLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const line = value.trim().split('\n')[0]?.trim() ?? '';
  if (!line) return null;
  return line.length > ONE_LINE ? `${line.slice(0, ONE_LINE - 1).trimEnd()}…` : line;
}

/**
 * What to call a row that cannot be read back.
 *
 * The foreign keys cascade, so a deleted row takes its comments with it and
 * this should not happen. It still can: the embed is subject to RLS like
 * everything else, and a column can be renamed under a deploy. A conversation
 * named after its kind is worth more than one dropped silently.
 */
const UNNAMED: Record<CommentTarget, string> = {
  idea: 'An idea',
  step: 'A plan step',
  raise: 'A raise',
  note: 'A note',
  spec: 'A spec section',
  takeaway: 'An inspiration takeaway',
  change: 'A spec change',
};

/** The target column the loader set on the row (one per turn). */
function targetOf(row: Record<string, unknown>): CommentTarget | null {
  return COMMENT_TARGETS.find((target) => row[TARGET_COLUMN[target]]) ?? null;
}

function aboutFrom(target: CommentTarget, parent: Record<string, unknown> | null): string {
  if (!parent) return UNNAMED[target];

  if (target === 'step') {
    const number = Number(parent.number);
    const title = firstLine(parent.title);
    if (!Number.isFinite(number)) return title ?? UNNAMED.step;
    return title ? `#${number} ${title}` : `#${number}`;
  }

  if (target === 'raise') return firstLine(parent.title) ?? UNNAMED.raise;
  if (target === 'takeaway') return firstLine(parent.title) ?? UNNAMED.takeaway;
  if (target === 'change') return firstLine(parent.title) ?? UNNAMED.change;

  // The heading, which is what somebody was actually arguing with.
  if (target === 'spec') return firstLine(parent.heading) ?? UNNAMED.spec;

  // A note has no title, so the sentence you filed is the name of it.
  if (target === 'note') {
    const unnamed =
      parent.kind === 'feature' ? 'A feature request' : parent.kind === 'like' ? 'A like' : 'A bug report';
    return firstLine(parent.body) ?? unnamed;
  }

  return firstLine(parent.body) ?? UNNAMED.idea;
}

/**
 * Where the conversation is read.
 *
 * Most targets are a list, so their path is fixed. A spec section lives on
 * its own document's page, and which document that is can only be read off the
 * embedded row -- so a thread whose section has gone falls back to the index
 * rather than to a 404. A spec change lands on its own card on /dev/specs.
 */
function hrefFor(target: CommentTarget, rowId: string, parent: Record<string, unknown> | null): string {
  if (target === 'spec' && typeof parent?.slug === 'string') {
    return `${TARGET_PATH.spec}/${parent.slug}`;
  }
  // The change's own card, which is where its thread is drawn (plan #1507).
  if (target === 'change') return `${TARGET_PATH.change}#spec-change-${rowId}`;
  return TARGET_PATH[target];
}

/**
 * One conversation per row, most recently active first.
 *
 * Ordered by the last message rather than by the first, so a thread answered
 * this morning comes back to the top of a list it has been sitting at the
 * bottom of for a week. Two threads written in the same second are ordered by
 * their row id, which is arbitrary but stable — a list that reshuffles between
 * two renders of the same data is worse than one in an odd order.
 */
export function conversationsFrom(
  rows: readonly Record<string, unknown>[],
  reads: ConversationReads = new Map(),
): Conversation[] {
  type Gathered = {
    conversation: Omit<Conversation, 'thread' | 'lastAt' | 'lastAuthor' | 'unread'>;
    comments: Record<string, unknown>[];
  };
  const byRow = new Map<string, Gathered>();

  for (const row of rows) {
    const target = targetOf(row);
    if (!target) continue;

    const rowId = String(row[TARGET_COLUMN[target]]);
    const key = conversationKey(target, rowId);
    const seen = byRow.get(key);
    if (seen) {
      seen.comments.push(row);
      continue;
    }

    byRow.set(key, {
      conversation: {
        target,
        rowId,
        about: aboutFrom(target, (row[target] as Record<string, unknown> | null) ?? null),
        href: hrefFor(target, rowId, (row[target] as Record<string, unknown> | null) ?? null),
      },
      comments: [row],
    });
  }

  const found = [...byRow.entries()].flatMap(([key, { conversation, comments }]) => {
    const thread = threadFrom(comments);
    const last = thread[thread.length - 1];
    if (!last) return [];
    return [
      {
        key,
        row: {
          ...conversation,
          thread,
          lastAt: last.createdAt,
          lastAuthor: last.author,
          unread: isUnread(last.author, last.createdAt, reads.get(key)),
        },
      },
    ];
  });

  found.sort((a, b) => b.row.lastAt.localeCompare(a.row.lastAt) || a.key.localeCompare(b.key));
  return found.map((entry) => entry.row);
}

/**
 * What each target's row is read for, to name the conversation: the same
 * columns the old embeds named, read by id now that the turns are in the
 * shared store and cannot embed the row (plan #1470).
 */
const PARENT_READS: Record<CommentTarget, { table: string; columns: string }> = {
  idea: { table: 'ideas', columns: 'id, body' },
  step: { table: 'plan_items', columns: 'id, number, title' },
  raise: { table: 'raised_items', columns: 'id, title' },
  note: { table: 'feedback_items', columns: 'id, kind, body' },
  spec: { table: 'spec_sections', columns: 'id, slug, heading' },
  takeaway: { table: 'inspiration_takeaways', columns: 'id, title' },
  change: { table: 'spec_changes', columns: 'id, title' },
};

/** Takes a client rather than building one, like everything else in lib/. */
export async function loadConversations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<Conversation[]> {
  const [turns, marks] = await Promise.all([
    supabase
      .schema('core')
      .from('thread_turns')
      .select('id, ref, author, body, created_at')
      .eq('user_id', userId)
      .like('ref', 'public.%')
      // Newest first, so a cap this ever grows into drops the oldest messages
      // rather than an arbitrary slice of them.
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('dev_comment_reads').select('target, row_id, read_at').eq('user_id', userId),
  ]);

  // Each turn as the row the fold reads: the comment, the column naming its
  // row, and (below) the row itself under the target's name.
  const rows: Record<string, unknown>[] = [];
  const idsByTarget = new Map<CommentTarget, Set<string>>();
  for (const turn of (turns.data ?? []) as { id: string; ref: string; author: string; body: string; created_at: string }[]) {
    const subject = threadSubject(turn.ref);
    if (!subject || !isCommentTarget(subject.target)) continue;
    const target = subject.target;
    rows.push({ id: turn.id, author: turn.author, body: turn.body, created_at: turn.created_at, [TARGET_COLUMN[target]]: subject.id });
    const ids = idsByTarget.get(target) ?? new Set<string>();
    ids.add(subject.id);
    idsByTarget.set(target, ids);
  }

  const parents = new Map<string, Record<string, unknown>>();
  await Promise.all(
    [...idsByTarget.entries()].map(async ([target, ids]) => {
      const { table, columns } = PARENT_READS[target];
      const { data } = await supabase.from(table).select(columns).eq('user_id', userId).in('id', [...ids]);
      for (const parent of (data ?? []) as unknown as Record<string, unknown>[]) {
        parents.set(conversationKey(target, String(parent.id)), parent);
      }
    }),
  );
  for (const row of rows) {
    const target = targetOf(row);
    if (target) row[target] = parents.get(conversationKey(target, String(row[TARGET_COLUMN[target]]))) ?? null;
  }

  const reads = (marks.data ?? []) as unknown as Array<Record<string, unknown>>;
  return conversationsFrom(rows, readsFrom(reads));
}
