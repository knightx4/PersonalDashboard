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
 * ledger under 'embed-idea'. The fields of the area catalogue (plan #1856) are a
 * second store run beside this one in the same stage.
 */

/** A row needs a vector when it has none or the wrong model made it. */
export function dueFilter(model: EmbeddingModel): string {
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

/** The text a field is embedded from: its name and what belongs in it. */
export function fieldText(field: { name: string; scope: string }): string {
  return `${field.name}. ${field.scope}`;
}

/**
 * A store over learn.area_fields (plan #1856). The catalogue is shared, not
 * per person, so there is no user filter. A row is written only while its
 * name and scope are those it was read with, so a field reworded by a
 * migration meanwhile is embedded again next time.
 */
export function fieldStore(learn: LearnSupabaseClient, model: EmbeddingModel): SegmentStore {
  return {
    async unembedded(limit) {
      const { data, error } = await learn
        .from('area_fields')
        .select('id, name, scope')
        .or(dueFilter(model))
        .order('domain_id')
        .order('position')
        .limit(limit);
      if (error) throw new Error(`Reading fields without an embedding failed: ${error.message}`);
      return ((data ?? []) as { id: string; name: string; scope: string }[]).map((row) => ({
        id: row.id,
        text: fieldText(row),
      }));
    },

    async store(rows) {
      let written = 0;
      for (const row of rows) {
        const { data: current, error: readError } = await learn
          .from('area_fields')
          .select('name, scope')
          .eq('id', row.id)
          .maybeSingle();
        if (readError) throw new Error(`Checking a field before storing its embedding failed: ${readError.message}`);
        if (!current || fieldText(current as { name: string; scope: string }) !== row.text) continue;
        const { data, error } = await learn
          .from('area_fields')
          .update({ embedding: vectorLiteral(row.vector), embedding_model: row.model })
          .eq('id', row.id)
          .select('id');
        if (error) throw new Error(`Storing a field's embedding failed: ${error.message}`);
        written += (data ?? []).length;
      }
      return written;
    },
  };
}

/**
 * Embed the fields that are due, billing `userId` under 'embed-idea'. The
 * fields belong to nobody, so the caller names whose account pays.
 */
export async function embedFieldsOverRest(
  learn: LearnSupabaseClient,
  userId: string,
  options: EmbedSweepOptions = {},
): Promise<EmbedSweepResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  return runEmbedSweep(
    {
      store: fieldStore(learn, model),
      embed: ({ texts, model: asked, onSpend }) =>
        embedTexts({ texts, model: asked, inputType: 'document', onSpend }),
      ledger: (report) => ledgerIdeaSpend(learn, userId, [report]),
    },
    { ...options, model },
  );
}

/** Whether any field is due. */
export async function fieldsDue(
  learn: LearnSupabaseClient,
  model: EmbeddingModel = DEFAULT_EMBEDDING_MODEL,
): Promise<boolean> {
  const { data, error } = await learn.from('area_fields').select('id').or(dueFilter(model)).limit(1);
  if (error) throw new Error(`Listing fields without an embedding failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** An account to bill for the fields when no idea is due: any one with ideas. */
export async function anyIdeaOwner(learn: LearnSupabaseClient): Promise<string | null> {
  const { data, error } = await learn.from('concepts').select('user_id').order('created_at').limit(1);
  if (error) throw new Error(`Finding an account to bill failed: ${error.message}`);
  return ((data ?? []) as { user_id: string }[])[0]?.user_id ?? null;
}
