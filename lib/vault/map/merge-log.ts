import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import type { MergeKind } from '@/lib/vault/map/merge-pass';
import type { MergeFailure } from '@/lib/vault/map/merge-apply';

/**
 * The merge log on the Map page (plan #821).
 *
 * Every `same` proposal is merged without review (#814 answered C), so the
 * page lists what was merged, with an undo on each. One page of the log is
 * shaped by obsidian.map_merge_log (supabase/migrations-vault/0015), because
 * a merge's own record carries every row it moved and a theme merge's runs to
 * about 90 kB: reading records through PostgREST to show two names would ship
 * megabytes a page.
 *
 * Theme merges come first, then position merges, newest first within each.
 */

export const MERGE_LOG_PAGE_SIZE = 25;

/** A note one side of the merge came from, and for a position the quote. */
export type MergeLogItem = {
  title: string | null;
  /** Null when the note has left the vault. */
  path: string | null;
  quote: string | null;
};

export type MergeLogSide = {
  name: string;
  /** Up to three notes (a theme) or quotes (a position). */
  items: MergeLogItem[];
  /** How many there are in all. */
  count: number;
};

export type MergeLogRow = {
  id: string;
  kind: MergeKind;
  mergedAt: string;
  undoneAt: string | null;
  survivorId: string;
  /** The side that was folded in. */
  absorbed: MergeLogSide;
  /** The side that was kept, under the name it had before the merge. */
  survivor: MergeLogSide;
  /** The survivor's name today; null when it has since been merged away itself. */
  survivorNameNow: string | null;
  /** The model's reason, from the proposal. Null for a merge made by hand. */
  reason: string | null;
};

export type MergeLogCounts = { theme: number; position: number; undone: number };

export type MergeLogPage = {
  rows: MergeLogRow[];
  counts: MergeLogCounts;
  /** 1-based. */
  page: number;
  pages: number;
};

type RawItem = { title?: string | null; path?: string | null; quote?: string | null };

export type RawMergeLogRow = {
  id: string;
  kind: MergeKind;
  merged_at: string;
  undone_at: string | null;
  survivor_id: string;
  absorbed_id: string;
  absorbed_name: string | null;
  survivor_name_before: string | null;
  survivor_name: string | null;
  reason: string | null;
  absorbed_items: RawItem[] | null;
  absorbed_count: number | null;
  survivor_items: RawItem[] | null;
  survivor_count: number | null;
};

type RawCount = { kind: MergeKind; merges: number; undone: number };

function items(raw: RawItem[] | null): MergeLogItem[] {
  return (raw ?? []).map((item) => ({
    title: item.title ?? null,
    path: item.path ?? null,
    quote: item.quote ?? null,
  }));
}

export function shapeMergeLogRow(raw: RawMergeLogRow): MergeLogRow {
  return {
    id: raw.id,
    kind: raw.kind,
    mergedAt: raw.merged_at,
    undoneAt: raw.undone_at,
    survivorId: raw.survivor_id,
    absorbed: {
      name: raw.absorbed_name ?? '',
      items: items(raw.absorbed_items),
      count: Number(raw.absorbed_count ?? 0),
    },
    survivor: {
      name: raw.survivor_name_before ?? '',
      items: items(raw.survivor_items),
      count: Number(raw.survivor_count ?? 0),
    },
    survivorNameNow: raw.survivor_name,
    reason: raw.reason,
  };
}

export function shapeMergeLogCounts(raw: RawCount[]): MergeLogCounts {
  const counts: MergeLogCounts = { theme: 0, position: 0, undone: 0 };
  for (const row of raw) {
    counts[row.kind] = Number(row.merges);
    counts.undone += Number(row.undone);
  }
  return counts;
}

/** The page asked for, as a whole number from 1 to the last page. */
export function clampPage(requested: string | string[] | undefined, total: number): number {
  const pages = Math.max(1, Math.ceil(total / MERGE_LOG_PAGE_SIZE));
  const n = Number.parseInt(Array.isArray(requested) ? (requested[0] ?? '') : (requested ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, pages);
}

/**
 * One page of the log. A failed read throws, for the vault's error.tsx: an
 * empty log is a real state with its own wording, and a broken read must not
 * be mistaken for it.
 */
export async function loadMergeLog(
  supabase: VaultSupabaseClient,
  requestedPage: string | string[] | undefined,
): Promise<MergeLogPage> {
  const { data: countData, error: countError } = await supabase.rpc('map_merge_log_counts');
  if (countError) throw new Error(`Could not count the map's merges: ${countError.message}`);
  const counts = shapeMergeLogCounts((countData ?? []) as RawCount[]);
  const total = counts.theme + counts.position;
  const page = clampPage(requestedPage, total);
  const pages = Math.max(1, Math.ceil(total / MERGE_LOG_PAGE_SIZE));
  if (total === 0) return { rows: [], counts, page, pages };

  const { data, error } = await supabase.rpc('map_merge_log', {
    p_limit: MERGE_LOG_PAGE_SIZE,
    p_offset: (page - 1) * MERGE_LOG_PAGE_SIZE,
  });
  if (error) throw new Error(`Could not read the map's merges: ${error.message}`);
  const rows = ((data ?? []) as RawMergeLogRow[]).map(shapeMergeLogRow);
  return { rows, counts, page, pages };
}

/** What the page says when an undo is refused, by the reason the database gave. */
export function undoRefusal(failure: MergeFailure): string {
  switch (failure.reason) {
    case 'gone':
      return 'That merge is no longer in the log.';
    case 'already-undone':
      return 'That merge has already been undone.';
    case 'survivor-gone':
      return failure.detail;
    case 'name-taken':
      return 'Another theme now has one of the two names. Rename it, then undo this.';
    default:
      return `The undo failed: ${failure.detail}`;
  }
}
