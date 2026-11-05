import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import { recordSpend } from '@/lib/core/spend/record';
import { jevApiKey } from '@/lib/jev/client';
import { jevEnabledFor } from '@/lib/jev/enabled';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import {
  IDEA_SCORE_RUBRIC_VERSION,
  scoreIdea,
  type IdeaScore,
  type IdeaSource,
} from '@/lib/vault/map/idea-score';
import {
  IDEA_SCORE_BATCH,
  runIdeaScores,
  type DueIdea,
  type IdeaScorePorts,
  type IdeaScoreRunResult,
  type LoadedIdea,
} from '@/lib/vault/map/idea-score-run';
import type { VaultRules } from '@/lib/vault/map/rules';
import { loadVaultRules } from '@/lib/vault/map/vault-rules';
import type { NoteVoice } from '@/lib/vault/notes/voice';

/**
 * The clock that scores map ideas with Jev (plan #2947.3), called every ten
 * minutes by pg_cron through /api/cron/idea-scores (migrations-vault/0045).
 *
 * One clock does the backfill, the new ideas the sweep or a note's Map
 * section writes, ideas a merge changed, and anything a failure left: each is
 * an idea obsidian.idea_score_due lists, so nothing has to send an event when
 * it writes one. A new idea is scored within ten minutes of being written.
 *
 * Works every account with a vault connection and Jev turned on, one after
 * another; an account without Jev is skipped and nothing of it is read. The
 * service client bypasses RLS, so every query names the account.
 */

/** Time one call spends on scoring. The route's limit is 300 seconds. */
export const IDEA_SCORES_BUDGET_MS = 240_000;

const OPERATION: LearnOperation = 'score-vault-ideas';

type PositionRow = { id: string; statement: string; basis: string | null };
type SourceRow = { position_id: string; note_id: string; quote: string };
type NoteRow = { id: string; title: string; path: string; voice: NoteVoice | null; body: string };
type ScoreRow = { position_id: string; input_hash: string; rubric_version: string };

export function ideaScorePorts(vault: VaultSupabaseClient, userId: string, rules: VaultRules): IdeaScorePorts {
  const core = createCoreServiceSupabase();
  const apiKey = jevApiKey();

  return {
    async due(limit) {
      const { data, error } = await vault.rpc('idea_score_due', {
        p_user_id: userId,
        p_rubric_version: IDEA_SCORE_RUBRIC_VERSION,
        p_limit: limit,
      });
      if (error) throw new Error(`Listing the ideas due a score failed: ${error.message}`);
      return ((data ?? []) as { position_id: string; source_sig: string }[]).map(
        (row): DueIdea => ({ positionId: row.position_id, sourceSig: row.source_sig }),
      );
    },

    async load(positionIds) {
      const loaded = new Map<string, LoadedIdea>();
      if (positionIds.length === 0) return loaded;
      const [positions, sources, scores] = await Promise.all([
        vault.from('positions').select('id, statement, basis').eq('user_id', userId).in('id', positionIds),
        vault
          .from('position_sources')
          .select('position_id, note_id, quote')
          .eq('user_id', userId)
          .in('position_id', positionIds),
        vault
          .from('position_scores')
          .select('position_id, input_hash, rubric_version')
          .eq('user_id', userId)
          .in('position_id', positionIds),
      ]);
      if (positions.error) throw new Error(`Reading the ideas failed: ${positions.error.message}`);
      if (sources.error) throw new Error(`Reading the ideas' quotes failed: ${sources.error.message}`);
      if (scores.error) throw new Error(`Reading the stored scores failed: ${scores.error.message}`);

      const sourceRows = (sources.data ?? []) as SourceRow[];
      const noteIds = [...new Set(sourceRows.map((row) => row.note_id))];
      const notes = new Map<string, NoteRow>();
      // The paragraph around each quote comes from the note's body (#2947.8),
      // so the body is read with the note; without it the hash differs from
      // the one the check scored.
      for (let i = 0; i < noteIds.length; i += IDEA_SCORE_BATCH) {
        const { data, error } = await vault
          .from('notes')
          .select('id, title, path, voice, body')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .in('id', noteIds.slice(i, i + IDEA_SCORE_BATCH));
        if (error) throw new Error(`Reading the ideas' notes failed: ${error.message}`);
        for (const note of (data ?? []) as NoteRow[]) notes.set(note.id, note);
      }

      const byPosition = new Map<string, IdeaSource[]>();
      for (const row of sourceRows) {
        const note = notes.get(row.note_id);
        if (!note) continue;
        const list = byPosition.get(row.position_id) ?? [];
        list.push({
          quote: row.quote,
          note: { title: note.title, path: note.path, voice: note.voice, body: note.body },
        });
        byPosition.set(row.position_id, list);
      }
      const stored = new Map(((scores.data ?? []) as ScoreRow[]).map((row) => [row.position_id, row]));

      for (const position of (positions.data ?? []) as PositionRow[]) {
        const row = stored.get(position.id);
        loaded.set(position.id, {
          idea: { statement: position.statement, basis: position.basis ?? '', sources: byPosition.get(position.id) ?? [] },
          stored: row ? { inputHash: row.input_hash, rubricVersion: row.rubric_version } : null,
        });
      }
      return loaded;
    },

    score: (idea, onSpend) => scoreIdea({ idea, rules, onSpend, apiKey }),

    async save(positionId, score, sourceSig) {
      const { error } = await vault.from('position_scores').upsert(scoreRow(userId, positionId, score, sourceSig), {
        onConflict: 'position_id',
      });
      if (error) throw new Error(`Saving an idea's score failed: ${error.message}`);
    },

    async touch(positionId, sourceSig) {
      const { error } = await vault
        .from('position_scores')
        .update({ source_sig: sourceSig })
        .eq('user_id', userId)
        .eq('position_id', positionId);
      if (error) throw new Error(`Updating an idea's signature failed: ${error.message}`);
    },

    async ledger(reports) {
      for (const report of reports) {
        await recordSpend(core, userId, {
          module: 'learn',
          operation: OPERATION,
          model: report.model,
          usage: report.usage,
        });
      }
    },

    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

/** One idea's score as its obsidian.position_scores row. */
export function scoreRow(userId: string, positionId: string, score: IdeaScore, sourceSig: string) {
  return {
    user_id: userId,
    position_id: positionId,
    idea_type: score.ideaType,
    usefulness: score.usefulness,
    novelty: score.novelty,
    usefulness_confidence: score.usefulnessConfidence,
    novelty_confidence: score.noveltyConfidence,
    usefulness_levels: score.usefulnessLevels,
    novelty_levels: score.noveltyLevels,
    type_probabilities: score.typeProbabilities,
    model: score.model,
    rubric_version: score.rubricVersion,
    input_hash: score.inputHash,
    source_sig: sourceSig,
    scored_at: new Date().toISOString(),
  };
}

export type IdeaScoresTickSummary = {
  people: number;
  /** Accounts skipped because Jev is not turned on for them. */
  withoutJev: number;
  results: { userId: string; result: IdeaScoreRunResult }[];
  failed: string[];
};

export async function runIdeaScoresTick(): Promise<IdeaScoresTickSummary> {
  const startedAt = Date.now();
  const vault = createVaultServiceSupabase();
  const core = createCoreServiceSupabase();
  const { data, error } = await vault.from('vault_connections').select('user_id');
  if (error) throw new Error(`Reading vault connections failed: ${error.message}`);
  const people = [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))];

  const summary: IdeaScoresTickSummary = { people: people.length, withoutJev: 0, results: [], failed: [] };
  for (const userId of people) {
    // Only an account that agreed to send its notes to TypeSafe (#1163).
    if (!(await jevEnabledFor(core, userId))) {
      summary.withoutJev += 1;
      continue;
    }
    try {
      const rules = await loadVaultRules(vault, userId);
      const result = await runIdeaScores({
        ports: ideaScorePorts(vault, userId, rules),
        rules,
        deadline: startedAt + IDEA_SCORES_BUDGET_MS,
      });
      summary.results.push({ userId, result });
    } catch (err) {
      // Carried on, so one account's failure costs nobody else their scores;
      // the next tick lists the same ideas again.
      summary.failed.push(`${userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
