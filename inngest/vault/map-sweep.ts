import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { acceptNoteMap } from '@/lib/vault/map/accept';
import { proposeNoteMap, type MapNote } from '@/lib/vault/map/extract';
import { runSweepSlice, type SweepNoteRow, type SweepPorts } from '@/lib/vault/map/sweep';
import { loadThemeNames } from '@/lib/vault/map/themes';

/**
 * One call of the map sweep's clock: work every running sweep for a few
 * minutes (plan #757). The runner is lib/vault/map/sweep.ts; this file is the
 * database, the model and the ledger behind its ports.
 *
 * The service client bypasses RLS, so every query below names the sweep's
 * owner. acceptNoteMap writes rows owned by the note's owner either way.
 */

/** Time one call spends. The route's limit is 300 seconds. */
export const SWEEP_BUDGET_MS = 240_000;

/**
 * How long a call holds the sweep. Longer than the route's limit, so a call
 * cannot lose the lease while it is still working, and short enough that a
 * dead call holds the sweep up for one tick at most.
 */
const LEASE_MS = 310_000;

const OPERATION: LearnOperation = 'map-sweep';

type SweepRow = { id: string; user_id: string; after_path: string | null; notes_total: number | null };

export type MapSweepTickSummary = {
  sweeps: number;
  reached: number;
  finished: number;
  failed: { sweepId: string; error: string }[];
};

export async function runMapSweepTick(): Promise<MapSweepTickSummary> {
  const supabase = createVaultServiceSupabase();
  const summary: MapSweepTickSummary = { sweeps: 0, reached: 0, finished: 0, failed: [] };

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('map_sweeps')
    .select('id')
    .eq('status', 'running')
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`);
  if (error) throw new Error(`Listing map sweeps failed: ${error.message}`);

  for (const { id } of (data ?? []) as { id: string }[]) {
    const sweep = await claim(supabase, id);
    if (!sweep) continue;
    summary.sweeps += 1;
    try {
      const result = await workSweep(supabase, sweep);
      summary.reached += result.reached;
      if (result.finished) summary.finished += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed';
      summary.failed.push({ sweepId: id, error: message });
      await supabase
        .from('map_sweeps')
        .update({ last_error: message, lease_until: null, updated_at: new Date().toISOString() })
        .eq('id', id);
    }
  }

  return summary;
}

/**
 * Take the lease, or null when another call holds it. The condition is in the
 * update itself, so two calls racing for one sweep cannot both win.
 */
async function claim(supabase: VaultSupabaseClient, id: string): Promise<SweepRow | null> {
  const now = Date.now();
  const { data } = await supabase
    .from('map_sweeps')
    .update({ lease_until: new Date(now + LEASE_MS).toISOString() })
    .eq('id', id)
    .eq('status', 'running')
    .or(`lease_until.is.null,lease_until.lt.${new Date(now).toISOString()}`)
    .select('id, user_id, after_path, notes_total')
    .maybeSingle();
  return (data as SweepRow | null) ?? null;
}

async function workSweep(supabase: VaultSupabaseClient, sweep: SweepRow) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('The sweep needs ANTHROPIC_API_KEY to be set.');

  const userId = sweep.user_id;

  // A row still `reading` belongs to a call that died partway through a note:
  // this call holds the lease, so no other call is reading it. Counting it as
  // failed moves the sweep past it instead of retrying it on every call.
  await check(
    supabase
      .from('map_sweep_notes')
      .update({
        outcome: 'failed',
        detail: 'The run reading this note stopped before it finished.',
        updated_at: new Date().toISOString(),
      })
      .eq('sweep_id', sweep.id)
      .eq('outcome', 'reading'),
    'Clearing a cut-off read',
  );

  if (sweep.notes_total === null) {
    const { count } = await supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null);
    await supabase.from('map_sweeps').update({ notes_total: count ?? null }).eq('id', sweep.id);
  }

  let spend: SpendReport[] = [];
  const core = createCoreServiceSupabase();

  const ports: SweepPorts = {
    async notesAfter(afterPath, limit) {
      let query = supabase
        .from('notes')
        .select('id, path, title, body, blob_sha')
        .eq('user_id', userId)
        .is('deleted_at', null);
      if (afterPath !== null) query = query.gt('path', afterPath);
      const { data, error } = await query.order('path').limit(limit);
      if (error) throw new Error(`Reading notes failed: ${error.message}`);
      return (data as { id: string; path: string; title: string; body: string; blob_sha: string }[]).map(
        (n): MapNote => ({ id: n.id, path: n.path, title: n.title, body: n.body, blobSha: n.blob_sha }),
      );
    },

    async reachedInSweep(noteIds) {
      if (noteIds.length === 0) return new Set();
      const { data, error } = await supabase
        .from('map_sweep_notes')
        .select('note_id')
        .eq('sweep_id', sweep.id)
        .in('note_id', noteIds);
      if (error) throw new Error(`Reading the sweep failed: ${error.message}`);
      return new Set((data as { note_id: string }[]).map((r) => r.note_id));
    },

    async settledVersions(noteIds) {
      const settled = new Map<string, string>();
      if (noteIds.length === 0) return settled;
      // Settled means an earlier sweep reached a firm answer about that
      // version: written with no failed sections, judged a record, read with
      // nothing in it, or already settled before. A failure is not settled,
      // so sweeping again retries it.
      const { data, error } = await supabase
        .from('map_sweep_notes')
        .select('note_id, blob_sha, outcome, failed_chunks')
        .eq('user_id', userId)
        .neq('sweep_id', sweep.id)
        .in('note_id', noteIds)
        .in('outcome', ['read', 'record', 'nothing', 'unchanged']);
      if (error) throw new Error(`Reading earlier sweeps failed: ${error.message}`);
      for (const r of data as { note_id: string; blob_sha: string; outcome: string; failed_chunks: unknown[] }[]) {
        if (r.outcome === 'read' && r.failed_chunks.length > 0) continue;
        settled.set(r.note_id, r.blob_sha);
      }
      return settled;
    },

    themeNames: () => loadThemeNames(supabase, 200, userId),

    propose: (note, existingThemes) =>
      proposeNoteMap({
        note,
        existingThemes,
        anthropicApiKey: apiKey,
        onSpend: (report) => spend.push(report),
      }),

    accept: (proposal) =>
      acceptNoteMap(supabase, {
        noteId: proposal.noteId,
        blobSha: proposal.blobSha,
        map: { themes: proposal.themes, positions: proposal.positions, edges: proposal.edges },
      }),

    async record(row: SweepNoteRow) {
      await check(
        supabase.from('map_sweep_notes').upsert(
          {
            user_id: userId,
            sweep_id: sweep.id,
            note_id: row.noteId,
            blob_sha: row.blobSha,
            outcome: row.outcome,
            detail: row.detail,
            themes: row.themes,
            positions: row.positions,
            new_positions: row.newPositions,
            skipped: row.skipped,
            failed_chunks: row.failedChunks,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'sweep_id,note_id' },
        ),
        'Recording a note',
      );
    },

    async saveProgress(afterPath) {
      await check(
        supabase
          .from('map_sweeps')
          .update({ after_path: afterPath, last_error: null, updated_at: new Date().toISOString() })
          .eq('id', sweep.id),
        'Saving the sweep position',
      );
    },

    async stillRunning() {
      const { data } = await supabase
        .from('map_sweeps')
        .select('status')
        .eq('id', sweep.id)
        .maybeSingle();
      return (data as { status: string } | null)?.status === 'running';
    },

    async afterBatch() {
      const reports = spend;
      spend = [];
      for (const report of reports) {
        await recordSpend(core, userId, {
          module: 'learn',
          operation: OPERATION,
          model: report.model,
          usage: report.usage,
        });
      }
    },
  };

  const result = await runSweepSlice({ afterPath: sweep.after_path, ports, budgetMs: SWEEP_BUDGET_MS });
  await ports.afterBatch?.();

  const finishedAt = new Date().toISOString();
  await check(
    supabase
      .from('map_sweeps')
      .update({
        lease_until: null,
        updated_at: finishedAt,
        ...(result.finished ? { status: 'done', finished_at: finishedAt, last_error: null } : {}),
      })
      .eq('id', sweep.id),
    'Releasing the sweep',
  );

  return result;
}

async function check(
  query: PromiseLike<{ error: { message: string } | null }>,
  what: string,
): Promise<void> {
  const { error } = await query;
  if (error) throw new Error(`${what} failed: ${error.message}`);
}
