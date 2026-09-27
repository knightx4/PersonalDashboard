import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import { recordSpend } from '@/lib/core/spend/record';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import {
  CONNECTION_MIN_SIMILARITY,
  NEIGHBOURS_PER_NOTE,
  type NeighbourPair,
} from '@/lib/vault/notes/connections';
import { openingOf, writeConnectionSentences } from '@/lib/vault/notes/connections-model';
import {
  runConnectionsFor,
  type ConnectionRunPorts,
  type ConnectionRunResult,
} from '@/lib/vault/notes/connections-run';

/**
 * The weekly connections run (plan #1115), called once a week by pg_cron
 * through /api/cron/note-connections (supabase/migrations/0106).
 *
 * Works every person with a vault, one after another. The service client
 * bypasses RLS, so every read and write names the person.
 */

const OPERATION: LearnOperation = 'write-note-connections';

type NeighbourRow = {
  recent_id: string;
  recent_path: string;
  recent_title: string | null;
  recent_chars: number;
  older_id: string;
  older_path: string;
  older_title: string | null;
  older_chars: number;
  similarity: number;
  mutual_rank: number;
};

function titleOf(title: string | null, path: string): string {
  return title?.trim() || path.replace(/^.*\//, '').replace(/\.md$/i, '');
}

export function connectionPorts(vault: VaultSupabaseClient): ConnectionRunPorts {
  const core = createCoreServiceSupabase();
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  return {
    async hasWeek(userId, weekEnding) {
      const { data, error } = await vault
        .from('note_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('week_ending', weekEnding)
        .limit(1);
      if (error) throw new Error(`Reading this week's connections failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async neighbours(userId, since) {
      const { data, error } = await vault.rpc('recent_note_neighbours', {
        p_user_id: userId,
        p_since: since,
        p_per_note: NEIGHBOURS_PER_NOTE,
        p_min_similarity: CONNECTION_MIN_SIMILARITY,
      });
      if (error) throw new Error(`Finding this week's neighbours failed: ${error.message}`);
      return ((data ?? []) as NeighbourRow[]).map(
        (row): NeighbourPair => ({
          recentId: row.recent_id,
          recentPath: row.recent_path,
          recentTitle: titleOf(row.recent_title, row.recent_path),
          recentChars: row.recent_chars,
          olderId: row.older_id,
          olderPath: row.older_path,
          olderTitle: titleOf(row.older_title, row.older_path),
          olderChars: row.older_chars,
          similarity: row.similarity,
          mutualRank: row.mutual_rank,
        }),
      );
    },

    async openings(userId, noteIds) {
      const { data, error } = await vault
        .from('notes')
        .select('id, body')
        .eq('user_id', userId)
        .in('id', noteIds);
      if (error) throw new Error(`Reading the notes' openings failed: ${error.message}`);
      return new Map(
        ((data ?? []) as { id: string; body: string | null }[]).map((row) => [row.id, openingOf(row.body ?? '')]),
      );
    },

    async sentences(groups, onSpend) {
      // Without a key the connections are still stored, with the notes and no sentence.
      if (!apiKey) return groups.map(() => null);
      return writeConnectionSentences(groups, { apiKey, onSpend });
    },

    async ledger(userId, report) {
      await recordSpend(core, userId, {
        module: 'learn',
        operation: OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },

    async write(rows) {
      const { error } = await vault
        .from('note_connections')
        .upsert(rows, { onConflict: 'user_id,week_ending,older_note_id', ignoreDuplicates: true });
      if (error) throw new Error(`Saving this week's connections failed: ${error.message}`);
    },
  };
}

export type NoteConnectionsSummary = {
  people: number;
  results: { userId: string; result: ConnectionRunResult }[];
  failed: string[];
};

export async function runNoteConnections(now: Date = new Date()): Promise<NoteConnectionsSummary> {
  const vault = createVaultServiceSupabase();
  const { data, error } = await vault.from('vault_connections').select('user_id');
  if (error) throw new Error(`Reading vault connections failed: ${error.message}`);
  const people = [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))];

  const ports = connectionPorts(vault);
  const summary: NoteConnectionsSummary = { people: people.length, results: [], failed: [] };
  for (const userId of people) {
    try {
      summary.results.push({ userId, result: await runConnectionsFor(ports, userId, now) });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
