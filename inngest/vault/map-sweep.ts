import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { acceptNoteMap } from '@/lib/vault/map/accept';
import { embedMapRows, type MapEmbedResult } from '@/lib/vault/map/embed';
import { applyMergeProposals, type ApplyResult } from '@/lib/vault/map/merge-apply';
import { proposePositionMerges, type PositionMergeResult } from '@/lib/vault/map/merge-positions';
import { proposeThemeMerges, type ThemeMergeResult } from '@/lib/vault/map/merge-themes';
import { proposeNoteMap, type MapNote } from '@/lib/vault/map/extract';
import { runSweepSlice, type SweepNoteRow, type SweepPorts } from '@/lib/vault/map/sweep';
import { loadNearestThemeNames, loadThemeNames } from '@/lib/vault/map/themes';

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

/**
 * When, from the start of a call, embedding stops starting new chunks. After
 * the sweeps and inside the route's 300-second limit, with room for the chunk
 * in flight.
 */
export const EMBED_UNTIL_MS = 280_000;

/**
 * When the theme merge pass stops starting new calls. Themes get the tick up
 * to here and positions get the rest (decision #844), so a theme backlog can
 * no longer use the whole tick and leave positions unjudged.
 */
export const THEME_MERGE_UNTIL_MS = 150_000;

/**
 * When applying the theme proposals stops (plan #820). Normally a few
 * seconds after the theme pass, since a merge takes about 25ms; the first run
 * over a backlog of two thousand uses the whole window and finishes on later
 * ticks.
 */
export const THEME_APPLY_UNTIL_MS = 180_000;

/**
 * When the position merge pass stops starting new calls. One call over twenty
 * pairs takes ten to twenty seconds, so this leaves room for the call in
 * flight and for applying what the pass proposed.
 */
export const POSITION_MERGE_UNTIL_MS = 255_000;

/** When applying the position proposals stops, inside the route's 300 seconds. */
export const POSITION_APPLY_UNTIL_MS = 285_000;

const OPERATION: LearnOperation = 'map-sweep';

type SweepRow = { id: string; user_id: string; after_path: string | null; notes_total: number | null };

export type MapSweepTickSummary = {
  sweeps: number;
  reached: number;
  finished: number;
  failed: { sweepId: string; error: string }[];
  /**
   * Themes and positions given a vector after the sweeps (plan #810): the
   * backfill, and the rows this call's sweeps accepted. Null when it threw.
   */
  embedded: Pick<MapEmbedResult, 'themes' | 'positions' | 'stopped'> | null;
  /**
   * Theme merge proposals written after embedding (plan #811). Null when the
   * pass did not run: no ANTHROPIC_API_KEY, embedding still catching up, or
   * it threw.
   */
  themeMerges: Pick<ThemeMergeResult, 'proposed' | 'same' | 'stopped'> | null;
  /**
   * Position merge proposals written after the theme pass (plan #812). Null
   * when it did not run, for the same three reasons as the theme pass.
   */
  positionMerges: Pick<PositionMergeResult, 'proposed' | 'same' | 'stopped'> | null;
  /**
   * Same-subject proposals merged after each pass (plan #820), themes before
   * positions. Null when that kind's apply threw.
   */
  applied: { theme: ApplyResult | null; position: ApplyResult | null };
};

export async function runMapSweepTick(): Promise<MapSweepTickSummary> {
  const startedAt = Date.now();
  const supabase = createVaultServiceSupabase();
  const summary: MapSweepTickSummary = {
    sweeps: 0,
    reached: 0,
    finished: 0,
    failed: [],
    embedded: null,
    themeMerges: null,
    positionMerges: null,
    applied: { theme: null, position: null },
  };

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

  // Every account's rows with no vector, whether a sweep ran or not. Without
  // EMBEDDING_API_KEY this stops at once with reason `no-key` and spends
  // nothing.
  try {
    const embedded = await embedMapRows(supabase, createCoreServiceSupabase(), {
      userId: null,
      deadline: startedAt + EMBED_UNTIL_MS,
    });
    summary.embedded = {
      themes: embedded.themes,
      positions: embedded.positions,
      stopped: embedded.stopped,
    };
  } catch (err) {
    console.error('[map sweep] embedding', err instanceof Error ? err.message : err);
  }

  // Theme pairs that have no merge proposal yet. Waits while embedding is
  // still working through a backlog, so pairs are found from vectors rather
  // than from names alone; a pair is judged once, so a tick with nothing new
  // asks nothing. Writing a proposal changes no theme.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && summary.embedded && summary.embedded.stopped?.reason !== 'time') {
    try {
      const merges = await proposeThemeMerges(supabase, createCoreServiceSupabase(), {
        userId: null,
        anthropicApiKey: apiKey,
        deadline: startedAt + THEME_MERGE_UNTIL_MS,
      });
      summary.themeMerges = {
        proposed: merges.proposed,
        same: merges.same,
        stopped: merges.stopped,
      };
    } catch (err) {
      console.error('[map sweep] theme merges', err instanceof Error ? err.message : err);
    }
  }

  // Every theme pair judged one subject is merged (decision #814), this
  // tick's and any left over from earlier ones. No model call, so it runs
  // whether or not the pass above could.
  summary.applied.theme = await applyKind(supabase, 'theme', startedAt + THEME_APPLY_UNTIL_MS);

  // Position pairs from different notes, after the theme pass. It has its
  // own share of the tick, from wherever the theme pass stopped until
  // POSITION_MERGE_UNTIL_MS, so it runs even when themes ran out of time.
  // Writing a proposal changes no position.
  if (apiKey && summary.embedded && summary.embedded.stopped?.reason !== 'time') {
    try {
      const merges = await proposePositionMerges(supabase, createCoreServiceSupabase(), {
        userId: null,
        anthropicApiKey: apiKey,
        deadline: startedAt + POSITION_MERGE_UNTIL_MS,
      });
      summary.positionMerges = {
        proposed: merges.proposed,
        same: merges.same,
        stopped: merges.stopped,
      };
    } catch (err) {
      console.error('[map sweep] position merges', err instanceof Error ? err.message : err);
    }
  }

  summary.applied.position = await applyKind(supabase, 'position', startedAt + POSITION_APPLY_UNTIL_MS);

  return summary;
}

async function applyKind(
  supabase: VaultSupabaseClient,
  kind: 'theme' | 'position',
  deadline: number,
): Promise<ApplyResult | null> {
  try {
    const result = await applyMergeProposals(supabase, kind, { userId: null, deadline });
    if (result.stopped?.reason === 'error')
      console.error(`[map sweep] applying ${kind} merges`, result.stopped.detail);
    return result;
  } catch (err) {
    console.error(`[map sweep] applying ${kind} merges`, err instanceof Error ? err.message : err);
    return null;
  }
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
  // Embedding each note to find its nearest themes, recorded as embed-map.
  let embedSpend: SpendReport[] = [];
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

    themeNames: () => loadThemeNames(supabase, undefined, userId),

    nearestThemes: (note) =>
      loadNearestThemeNames(supabase, note, {
        userId,
        onSpend: (report) => embedSpend.push(report),
      }),

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

    async forget(noteId) {
      await check(
        supabase.from('map_sweep_notes').delete().eq('sweep_id', sweep.id).eq('note_id', noteId),
        'Clearing a note to read again',
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
      const embedded = embedSpend;
      embedSpend = [];
      for (const report of embedded) {
        await recordSpend(core, userId, {
          module: 'learn',
          operation: 'embed-map',
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
        ...(result.outOfCredits
          ? {
              status: 'stopped',
              last_error:
                'Anthropic refused the request because the account is out of credit. Add credit, then press Sweep to carry on from where it stopped.',
            }
          : {}),
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
