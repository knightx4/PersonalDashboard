import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import type { SweepOutcome } from '@/lib/vault/map/sweep';

/**
 * The person's latest sweep, as the map page shows it (plan #757).
 *
 * Reads through the session client, so RLS narrows every query to the
 * person's own rows. A failed read throws, for the same reason read.ts does:
 * a broken read must not look like a vault that has never been swept.
 */

export type SweepStatus = 'running' | 'stopped' | 'done';

export type SweepView = {
  id: string;
  status: SweepStatus;
  notesTotal: number | null;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  /** Notes reached, by what happened to them. */
  outcomes: Partial<Record<SweepOutcome, number>>;
  reached: number;
  /** Notes longer than the read cap, read only up to it. */
  cutShort: number;
  /** Notes written to the map with one or more sections that failed to read. */
  sectionsFailed: number;
  positions: number;
  newPositions: number;
  /** The first few failures, so the page can say which notes and why. */
  failures: { title: string; detail: string }[];
};

const FAILURES_SHOWN = 10;

type Counts = {
  outcomes: Partial<Record<SweepOutcome, number>>;
  cutShort: number;
  sectionsFailed: number;
  positions: number;
  newPositions: number;
};

export async function loadLatestSweep(supabase: VaultSupabaseClient): Promise<SweepView | null> {
  const { data, error } = await supabase
    .from('map_sweeps')
    .select('id, status, notes_total, started_at, finished_at, last_error')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the sweep failed: ${error.message}`);
  if (!data) return null;

  const sweep = data as {
    id: string;
    status: SweepStatus;
    notes_total: number | null;
    started_at: string;
    finished_at: string | null;
    last_error: string | null;
  };

  const counted = await supabase.rpc('map_sweep_counts', { p_sweep_id: sweep.id });
  if (counted.error) throw new Error(`Counting the sweep failed: ${counted.error.message}`);
  const counts = counted.data as Counts;

  const failedRows = await supabase
    .from('map_sweep_notes')
    .select('note_id, detail')
    .eq('sweep_id', sweep.id)
    .eq('outcome', 'failed')
    .order('updated_at')
    .limit(FAILURES_SHOWN);
  if (failedRows.error) throw new Error(`Reading the sweep failed: ${failedRows.error.message}`);
  const failed = failedRows.data as { note_id: string; detail: string | null }[];

  const titles = new Map<string, string>();
  if (failed.length > 0) {
    const notes = await supabase
      .from('notes')
      .select('id, title')
      .in(
        'id',
        failed.map((row) => row.note_id),
      );
    if (notes.error) throw new Error(`Reading the sweep failed: ${notes.error.message}`);
    for (const note of notes.data as { id: string; title: string }[]) titles.set(note.id, note.title);
  }

  const reached = Object.values(counts.outcomes).reduce((sum, n) => sum + (n ?? 0), 0);

  return {
    id: sweep.id,
    status: sweep.status,
    notesTotal: sweep.notes_total,
    startedAt: sweep.started_at,
    finishedAt: sweep.finished_at,
    lastError: sweep.last_error,
    outcomes: counts.outcomes,
    reached,
    cutShort: counts.cutShort,
    sectionsFailed: counts.sectionsFailed,
    positions: counts.positions,
    newPositions: counts.newPositions,
    failures: failed.map((row) => ({
      title: titles.get(row.note_id) ?? 'A note no longer in the vault',
      detail: row.detail ?? 'No reason was recorded.',
    })),
  };
}
