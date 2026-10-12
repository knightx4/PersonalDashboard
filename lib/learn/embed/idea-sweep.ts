import 'server-only';

import {
  runEmbedSweep,
  vectorLiteral,
  type EmbedSweepOptions,
  type EmbedSweepResult,
  type SegmentStore,
} from '@/lib/learn/catalogue/embed-sweep';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';
import { ledgerIdeaSpend } from '@/lib/learn/embed/idea-embedding';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingModel } from '@/lib/learn/embed/voyage';

/**
 * The daily fill-in for idea embeddings (plan #1854).
 *
 * Every route that saves an idea embeds its claim as it goes (#1853), and
 * stays silent when the call fails. This is what catches those, and the ideas
 * saved before #1853: any row of learn.concepts with no vector, or one made
 * by a model other than the current one, is embedded here. The work is
 * defined by the absence of a vector, as in the catalogue's sweep, so a run
 * that dies halfway leaves the rest where the next run looks for it.
 *
 * The claim alone is embedded, as everywhere else, so every vector answers the
 * same question and `nearest_concepts` compares like with like.
 *
 * One person at a time, since each embedding call is billed to the account
 * whose ideas it embeds. The loop, the stop rules and the result are the
 * catalogue's (`runEmbedSweep`); this file is a store over concepts and a
 * ledger under 'embed-idea'. Plan #1856 adds the fields as a second store
 * run beside this one in the same stage.
 */

/** A row needs a vector when it has none or the wrong model made it. */
function dueFilter(model: EmbeddingModel): string {
  return `embedding.is.null,embedding_model.is.null,embedding_model.neq.${model}`;
}

export function ideaStore(learn: LearnSupabaseClient, userId: string, model: EmbeddingModel): SegmentStore {
  return {
    async unembedded(limit) {
      const { data, error } = await learn
        .from('concepts')
        .select('id, claim')
        .eq('user_id', userId)
        .or(dueFilter(model))
        .neq('claim', '')
        .order('created_at')
        .limit(limit);
      if (error) throw new Error(`Reading ideas without an embedding failed: ${error.message}`);
      return ((data ?? []) as { id: string; claim: string }[]).map((row) => ({ id: row.id, text: row.claim }));
    },

    async store(rows) {
      let written = 0;
      for (const row of rows) {
        // Matches on the claim read, so an idea reworded meanwhile keeps its
        // old state and is embedded again next time.
        const { data, error } = await learn
          .from('concepts')
          .update({ embedding: vectorLiteral(row.vector), embedding_model: row.model })
          .eq('id', row.id)
          .eq('user_id', userId)
          .eq('claim', row.text)
          .select('id');
        if (error) throw new Error(`Storing an idea's embedding failed: ${error.message}`);
        written += (data ?? []).length;
      }
      return written;
    },
  };
}

/** Embed this person's ideas that are due, billing them under 'embed-idea'. */
export async function embedIdeasOverRest(
  learn: LearnSupabaseClient,
  userId: string,
  options: EmbedSweepOptions = {},
): Promise<EmbedSweepResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  return runEmbedSweep(
    {
      store: ideaStore(learn, userId, model),
      embed: ({ texts, model: asked, onSpend }) =>
        embedTexts({ texts, model: asked, inputType: 'document', onSpend }),
      ledger: (report) => ledgerIdeaSpend(learn, userId, [report]),
    },
    { ...options, model },
  );
}

/** The accounts with at least one idea due. */
export async function usersWithIdeasDue(
  learn: LearnSupabaseClient,
  model: EmbeddingModel = DEFAULT_EMBEDDING_MODEL,
): Promise<string[]> {
  const { data, error } = await learn
    .from('concepts')
    .select('user_id')
    .or(dueFilter(model))
    .neq('claim', '')
    .order('created_at')
    .limit(1000);
  if (error) throw new Error(`Listing ideas without an embedding failed: ${error.message}`);
  return [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))];
}
