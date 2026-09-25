import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { costMicrosFor, type SpendReport } from '@/lib/core/spend/pricing';
import { embedTexts } from '@/lib/learn/embed/embed';
import {
  runEmbedSweep,
  vectorLiteral,
  type EmbedSweepOptions,
  type EmbedSweepResult,
  type SegmentStore,
} from './embed-sweep';

/**
 * The embedding pass over HTTPS, for video segments.
 *
 * `embedCatalogueSegments` runs over a `postgres` connection, which the
 * deployed app could not open until lib/env.ts fell back to POSTGRES_URL, so
 * nothing in the live catalogue had ever been embedded. This is the same loop (`runEmbedSweep`) over the service-role
 * client, limited to segments of `video` items: the transcripts the YouTube
 * library fetches. The Wikipedia sections Learn now picks are left alone,
 * because Learn now reads them without vectors and embedding them is a spend
 * nobody has asked for.
 *
 * One difference from the SQL store: the write matches on the segment id
 * alone. PostgREST would put the segment text in the URL to match on it, and a
 * transcript span is too long for that. The race it guarded against, a segment
 * rewritten between the read and the write, needs a second writer, and the
 * transcript runner and this pass run one after the other in the same request.
 */

const OPERATION = 'embed-catalogue';

export function restVideoSegmentStore(learn: LearnSupabaseClient): SegmentStore {
  return {
    async unembedded(limit) {
      const { data, error } = await learn
        .from('catalogue_segments')
        .select('id, text, catalogue_items!catalogue_segments_item_id_fkey!inner(kind)')
        .is('embedding', null)
        .eq('catalogue_items.kind', 'video')
        .order('item_id')
        .order('ordinal')
        .limit(limit);
      if (error) throw new Error(`Reading unembedded segments failed: ${error.message}`);
      return ((data ?? []) as { id: string; text: string }[]).map((row) => ({ id: row.id, text: row.text }));
    },

    async store(rows) {
      let written = 0;
      const at = new Date().toISOString();
      for (const row of rows) {
        const { data, error } = await learn
          .from('catalogue_segments')
          .update({ embedding: vectorLiteral(row.vector), embedding_model: row.model, embedded_at: at })
          .eq('id', row.id)
          .select('id');
        if (error) throw new Error(`Storing a segment's embedding failed: ${error.message}`);
        written += (data ?? []).length;
      }
      return written;
    },
  };
}

/** One spend row per call, under the owner, as `catalogueLedger` does. */
export function restLedger(learn: LearnSupabaseClient, userId: string): (report: SpendReport) => Promise<void> {
  return async (report) => {
    const { error } = await learn
      .schema('core')
      .from('model_spend')
      .insert({
        user_id: userId,
        module: 'learn',
        operation: OPERATION,
        model: report.model,
        input_tokens: report.usage.inputTokens,
        cached_input_tokens: report.usage.cachedInputTokens,
        cache_write_tokens: report.usage.cacheWriteTokens,
        output_tokens: report.usage.outputTokens,
        cost_micros: costMicrosFor(report.model, report.usage),
      });
    if (error) console.error('[core.model_spend] learn/embed-catalogue', error.message);
  };
}

export async function embedVideoSegmentsOverRest(
  learn: LearnSupabaseClient,
  options: EmbedSweepOptions & { userId: string | null },
): Promise<EmbedSweepResult> {
  return runEmbedSweep(
    {
      store: restVideoSegmentStore(learn),
      embed: ({ texts, model, onSpend }) => embedTexts({ texts, model, inputType: 'document', onSpend }),
      ledger: options.userId ? restLedger(learn, options.userId) : undefined,
    },
    options,
  );
}
