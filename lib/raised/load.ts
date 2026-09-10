import type { SupabaseClient } from '@supabase/supabase-js';
import { isModuleId, type ModuleId } from '@/lib/modules';

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
  /** The workspace it is about, or null for the app as a whole. */
  module: ModuleId | null;
  /** Which run raised it, and what it was doing. Free text from the session. */
  source: string | null;
  status: RaisedStatus;
  createdAt: string;
  /** When you answered it. Null while it is open, and null on a dismissal. */
  answeredAt: string | null;
};

export interface RaisedQueue {
  rows: RaisedRow[];
  open: RaisedRow[];
  closed: RaisedRow[];
  openCount: number;
}

export function isOpen(row: RaisedRow): boolean {
  return row.status === 'open';
}

/** Every column the app reads off a raise. */
export const RAISED_COLUMNS = 'id, title, detail, module, source, status, created_at, answered_at';

/** A row as the app reads it. One shape leaves here, whoever selected it. */
export function raisedRowFrom(row: Record<string, unknown>): RaisedRow {
  const scope = row.module as string | null;
  return {
    id: row.id as string,
    title: row.title as string,
    detail: (row.detail as string | null) ?? null,
    // A module removed from lib/modules leaves a harmless string in the
    // column, and it reads back as the whole app rather than as a workspace
    // nothing can look up. Same as ideas.
    module: scope && isModuleId(scope) ? scope : null,
    source: (row.source as string | null) ?? null,
    status: row.status as RaisedStatus,
    createdAt: row.created_at as string,
    answeredAt: (row.answered_at as string | null) ?? null,
  };
}

/**
 * Open first, newest first within each half — the same shape the notes queue
 * uses, for the same reason: what is still waiting on you goes at the top, and
 * the answered ones are history you scroll to.
 */
export function raisedQueueFrom(rows: readonly RaisedRow[]): RaisedQueue {
  const byNewest = (a: RaisedRow, b: RaisedRow) => b.createdAt.localeCompare(a.createdAt);
  const open = rows.filter(isOpen).sort(byNewest);
  const closed = rows.filter((row) => !isOpen(row)).sort(byNewest);

  return { rows: [...open, ...closed], open, closed, openCount: open.length };
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

  return raisedQueueFrom(((data ?? []) as Array<Record<string, unknown>>).map(raisedRowFrom));
}
