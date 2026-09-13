import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENT_COLUMNS, threadFrom, type DevComment } from '@/lib/comments/load';
import { isModuleId, type ModuleId } from '@/lib/modules';
import { consequenceFrom, type RaiseConsequence } from './consequence';

/**
 * What sessions have raised, read for the dev pages.
 *
 * A raise is a session asking for something it will not decide on its own. It
 * is neither a note — which is what you report as wrong — nor a plan decision,
 * which belongs to one feature and closes when that feature is built. The page
 * and the sidebar count both read through here, so there is one query and one
 * ordering behind both.
 */

/** Mirrors the `raised_items_status_ck` check. */
export type RaisedStatus = 'open' | 'answered' | 'dismissed';

export type RaisedRow = {
  id: string;
  title: string;
  detail: string | null;
  /**
   * The move it wants from you: a question, an action to approve, or a choice
   * between named options. Null on the rows filed before there was a column
   * for it — everything raised from here carries one.
   */
  ask: string | null;
  /**
   * What answering yes does: the action itself, and the sentence the page
   * shows under the ask. Null on the rows filed before there was a column for
   * it — everything raised from here names one.
   */
  consequence: RaiseConsequence | null;
  /**
   * What closing it produced: what the action did, or the reason there was
   * none. Null on a raise that closed into nothing, which is what the page
   * shows as still waiting on its own follow-through.
   */
  outcome: string | null;
  /** The workspace it is about, or null for the app as a whole. */
  module: ModuleId | null;
  /** Which run raised it, and what it was doing. Free text from the session. */
  source: string | null;
  status: RaisedStatus;
  createdAt: string;
  /** When you answered it. Null while it is open, and null on a dismissal. */
  answeredAt: string | null;
  /** The thread, oldest first. Empty until somebody says something. */
  thread: DevComment[];
};

export interface RaisedQueue {
  rows: RaisedRow[];
  open: RaisedRow[];
  /** Answered, but nothing was recorded as having come of it. */
  unfinished: RaisedRow[];
  closed: RaisedRow[];
  openCount: number;
}

export function isOpen(row: RaisedRow): boolean {
  return row.status === 'open';
}

/**
 * Answered, and nothing came of it.
 *
 * The #342 raise was answered yes and closed while the thing it described was
 * still possible. A raise that reached `answered` without an action or a
 * reason for none is not finished, whatever its status says, so it is listed
 * as waiting on its own follow-through rather than among the closed rows. A
 * dismissal is not this: putting one aside without saying anything is allowed.
 */
export function needsFollowThrough(row: RaisedRow): boolean {
  return row.status === 'answered' && !row.outcome;
}

/** Every column the app reads off a raise, and the thread under it. */
export const RAISED_COLUMNS =
  'id, title, detail, ask, consequence, outcome, module, source, status, created_at, ' +
  'answered_at, ' +
  `thread:dev_comments(${COMMENT_COLUMNS})`;

/** A row as the app reads it. One shape leaves here, whoever selected it. */
export function raisedRowFrom(row: Record<string, unknown>): RaisedRow {
  const raw = row.module as string | null;
  // Named `scope` rather than `module`, which Next reserves. A module removed
  // from lib/modules reads back as the whole app, and the consequence's
  // sentence has to say the same thing, so it is read from what the row ends
  // up with rather than from the column.
  const scope = raw && isModuleId(raw) ? raw : null;
  return {
    id: row.id as string,
    title: row.title as string,
    detail: (row.detail as string | null) ?? null,
    ask: (row.ask as string | null) ?? null,
    consequence: consequenceFrom(row.consequence, scope),
    outcome: (row.outcome as string | null) ?? null,
    // A module removed from lib/modules leaves a harmless string in the
    // column, and it reads back as the whole app rather than as a workspace
    // nothing can look up. Same as ideas.
    module: scope,
    source: (row.source as string | null) ?? null,
    status: row.status as RaisedStatus,
    createdAt: row.created_at as string,
    answeredAt: (row.answered_at as string | null) ?? null,
    thread: threadFrom(row.thread),
  };
}

/**
 * Open first, then the ones that closed into nothing, then the rest — newest
 * first within each. What is waiting on you goes at the top for the same
 * reason the notes queue does it; the ones that produced nothing go under it
 * because they are not finished either, and a page that filed them with the
 * history is the page the #342 raise disappeared into.
 */
export function raisedQueueFrom(rows: readonly RaisedRow[]): RaisedQueue {
  const byNewest = (a: RaisedRow, b: RaisedRow) => b.createdAt.localeCompare(a.createdAt);
  const open = rows.filter(isOpen).sort(byNewest);
  const unfinished = rows.filter(needsFollowThrough).sort(byNewest);
  const closed = rows
    .filter((row) => !isOpen(row) && !needsFollowThrough(row))
    .sort(byNewest);

  return {
    rows: [...open, ...unfinished, ...closed],
    open,
    unfinished,
    closed,
    openCount: open.length,
  };
}

/**
 * Takes a client rather than building one, like everything else in lib/. The
 * page reads as you and the sidebar reads as you, so both go through RLS.
 */
export async function loadRaised(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<RaisedQueue> {
  const { data } = await supabase
    .from('raised_items')
    .select(RAISED_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  // Through `unknown`: the column list is built as an expression, so the
  // client cannot infer a row shape from it and types the result as its
  // error case instead.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  return raisedQueueFrom(rows.map(raisedRowFrom));
}
