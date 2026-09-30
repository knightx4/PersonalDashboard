import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { askJev } from '@/lib/jev/client';
import { jevEnabledFor } from '@/lib/jev/enabled';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { MAYA_GATE_QUESTION, mayaGateState, type GateOutcome } from '@/lib/vault/maya/gate';
import {
  runMayaGateFor,
  type GateCandidate,
  type GateRunPorts,
  type GateRunResult,
  type PriorCheck,
} from '@/lib/vault/maya/gate-run';
import { saveThought } from '@/lib/vault/maya/store';
import { MAYA_THOUGHT_OPERATION, writeThought } from '@/lib/vault/maya/thought';

/**
 * Maya's hourly job (plan #1289), called by pg_cron through
 * /api/cron/maya-gate (supabase/migrations/0131_maya_gate_cron.sql).
 *
 * Works every person with a vault, one after another; the rules are in
 * lib/vault/maya/gate-run.ts. The service client bypasses RLS, so every read
 * and write names the person. Jev's calls are recorded as 'gate-maya-note'
 * and Maya's as 'write-maya-thought', both against the note's owner.
 */

/** The most changed notes read for one person in one tick; a full resync is worked through hour by hour. */
const CHANGED_LIMIT = 200;

type NoteRow = { id: string; path: string; title: string | null; body: string | null; blob_sha: string };

function titleOf(title: string | null, path: string): string {
  return title?.trim() || path.replace(/^.*\//, '').replace(/\.md$/i, '');
}

const GATE_OPERATION: LearnOperation = 'gate-maya-note';

export function mayaGatePorts(vault: VaultSupabaseClient, started = Date.now()): GateRunPorts {
  const core = createCoreServiceSupabase();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? undefined;

  async function ledger(userId: string, operation: LearnOperation, reports: SpendReport[]) {
    for (const report of reports) {
      await recordSpend(core, userId, { module: 'learn', operation, model: report.model, usage: report.usage });
    }
  }

  return {
    async changedNotes(userId, since) {
      const { data, error } = await vault
        .from('notes')
        .select('id, path, title, body, blob_sha')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .gte('updated_at', since.toISOString())
        .order('updated_at', { ascending: true })
        .limit(CHANGED_LIMIT);
      if (error) throw new Error(`Reading changed notes failed: ${error.message}`);
      return ((data ?? []) as NoteRow[]).map(
        (row): GateCandidate => ({
          id: row.id,
          path: row.path,
          title: titleOf(row.title, row.path),
          body: row.body ?? '',
          blobSha: row.blob_sha,
        }),
      );
    },

    async priorChecks(userId, noteIds) {
      const { data, error } = await vault
        .from('maya_gate_checks')
        .select('note_id, blob_sha, outcome, probability')
        .eq('user_id', userId)
        .in('note_id', noteIds);
      if (error) throw new Error(`Reading gate checks failed: ${error.message}`);
      return (
        (data ?? []) as { note_id: string; blob_sha: string; outcome: GateOutcome; probability: number | string | null }[]
      ).map(
        (row): PriorCheck => ({
          noteId: row.note_id,
          blobSha: row.blob_sha,
          outcome: row.outcome,
          probability: row.probability === null ? null : Number(row.probability),
        }),
      );
    },

    async threadedNotes(userId, noteIds) {
      const { data, error } = await vault
        .from('maya_threads')
        .select('note_id')
        .eq('user_id', userId)
        .in('note_id', noteIds);
      if (error) throw new Error(`Reading Maya's threads failed: ${error.message}`);
      return new Set(((data ?? []) as { note_id: string }[]).map((row) => row.note_id));
    },

    jevEnabled: (userId) => jevEnabledFor(core, userId),

    async ask(userId, note) {
      const spend: SpendReport[] = [];
      const result = await askJev({
        state: mayaGateState(note),
        question: MAYA_GATE_QUESTION,
        onSpend: (report) => spend.push(report),
      });
      await ledger(userId, GATE_OPERATION, spend);
      return result;
    },

    async automaticSince(userId, since) {
      const { count, error } = await vault
        .from('maya_threads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('origin', 'automatic')
        .gte('created_at', since.toISOString());
      if (error) throw new Error(`Counting today's thoughts failed: ${error.message}`);
      return count ?? 0;
    },

    async think(userId, note) {
      const spend: SpendReport[] = [];
      const written = await writeThought({
        vault,
        userId,
        noteId: note.id,
        anthropicApiKey,
        onSpend: (report) => spend.push(report),
      });
      await ledger(userId, MAYA_THOUGHT_OPERATION, spend);

      if (!written.ok) return { ok: false, empty: written.reason === 'not-read', detail: written.detail };
      if (written.points.length === 0) {
        return { ok: false, empty: true, detail: 'Maya had nothing worth saying about this note yet.' };
      }
      const saved = await saveThought(vault, { userId, noteId: note.id, origin: 'automatic', written });
      return saved.ok ? { ok: true, threadId: saved.threadId } : { ok: false, empty: false, detail: saved.detail };
    },

    async record(userId, rows) {
      if (rows.length === 0) return;
      const { error } = await vault.from('maya_gate_checks').upsert(
        rows.map((row) => ({
          user_id: userId,
          note_id: row.noteId,
          blob_sha: row.blobSha,
          outcome: row.outcome,
          probability: row.probability,
          jev_model: row.jevModel,
        })),
        { onConflict: 'note_id,blob_sha' },
      );
      if (error) throw new Error(`Recording gate checks failed: ${error.message}`);
    },

    elapsedMs: () => Date.now() - started,
  };
}

export type MayaGateSummary = {
  people: number;
  results: { userId: string; result: GateRunResult }[];
  failed: string[];
};

export async function runMayaGate(now: Date = new Date()): Promise<MayaGateSummary> {
  const vault = createVaultServiceSupabase();
  const { data, error } = await vault.from('vault_connections').select('user_id');
  if (error) throw new Error(`Reading vault connections failed: ${error.message}`);
  const people = [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))];

  const ports = mayaGatePorts(vault);
  const summary: MayaGateSummary = { people: people.length, results: [], failed: [] };
  for (const userId of people) {
    try {
      summary.results.push({ userId, result: await runMayaGateFor(ports, userId, now) });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
