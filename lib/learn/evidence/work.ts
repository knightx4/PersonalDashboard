import 'server-only';

import {
  runEmbedSweep,
  vectorLiteral,
  type EmbedSweepResult,
  type SegmentStore,
} from '@/lib/learn/catalogue/embed-sweep';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';
import { ledgerIdeaSpend } from '@/lib/learn/embed/idea-embedding';
import { dueFilter } from '@/lib/learn/embed/idea-sweep';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingModel } from '@/lib/learn/embed/voyage';
import { splitResume } from './resume-passages';

/**
 * Linking ideas to your work history (plan #2006.5), as a stage of the daily
 * run after the idea embeddings.
 *
 * 1. The latest résumé is split into passages here (./resume-passages) and,
 *    with the Career notes' passages the vault has already embedded, brought
 *    up to date in learn.work_passages by learn.sync_work_passages (migration
 *    learn 0124).
 * 2. Résumé passages with no vector are embedded with the model ideas use,
 *    billed under 'embed-idea'. Without the embedding key this is skipped and
 *    only the passages that already have one are matched.
 * 3. learn.refresh_work_evidence matches every passage with the ideas at 0.6
 *    or above, five per idea at most, and writes them to learn.evidence_links
 *    as 'work' links: the résumé and Career notes at full weight, application
 *    notes at 0.4. Links no longer found are removed there.
 */

export type WorkEvidenceResult = {
  passages: number;
  embedded: EmbedSweepResult | null;
  links: number;
};

type Rpc = <T>(
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: T | null; error: { message: string } | null }>;

function rpcOf(learn: LearnSupabaseClient): Rpc {
  return learn.rpc as unknown as Rpc;
}

/** Résumé passages that have no vector from the current model. */
export function workPassageStore(
  learn: LearnSupabaseClient,
  userId: string,
  model: EmbeddingModel,
): SegmentStore {
  return {
    async unembedded(limit) {
      const { data, error } = await learn
        .from('work_passages')
        .select('id, body')
        .eq('user_id', userId)
        .eq('origin', 'resume')
        .or(dueFilter(model))
        .order('position')
        .limit(limit);
      if (error) throw new Error(`Reading work passages without an embedding failed: ${error.message}`);
      return ((data ?? []) as { id: string; body: string }[]).map((row) => ({ id: row.id, text: row.body }));
    },

    async store(rows) {
      let written = 0;
      for (const row of rows) {
        const { data, error } = await learn
          .from('work_passages')
          .update({ embedding: vectorLiteral(row.vector), embedding_model: row.model })
          .eq('id', row.id)
          .eq('user_id', userId)
          .eq('body', row.text)
          .select('id');
        if (error) throw new Error(`Storing a work passage's embedding failed: ${error.message}`);
        written += (data ?? []).length;
      }
      return written;
    },
  };
}

export async function refreshWorkEvidence(
  learn: LearnSupabaseClient,
  userId: string,
  options: { embed: boolean; deadline?: number },
): Promise<WorkEvidenceResult> {
  const rpc = rpcOf(learn);

  const latest = await rpc<{ id: string; label: string | null; text_content: string }[]>('latest_resume', {
    p_user_id: userId,
  });
  if (latest.error) throw new Error(`Reading the latest résumé failed: ${latest.error.message}`);
  const resume = latest.data?.[0] ?? null;

  const synced = await rpc<number>('sync_work_passages', {
    p_user_id: userId,
    p_resume_id: resume?.id ?? null,
    p_title: resume?.label ?? null,
    p_passages: resume ? splitResume(resume.text_content) : [],
  });
  if (synced.error) throw new Error(`Updating the work passages failed: ${synced.error.message}`);

  let embedded: EmbedSweepResult | null = null;
  if (options.embed) {
    const model = DEFAULT_EMBEDDING_MODEL;
    embedded = await runEmbedSweep(
      {
        store: workPassageStore(learn, userId, model),
        embed: ({ texts, model: asked, onSpend }) =>
          embedTexts({ texts, model: asked, inputType: 'document', onSpend }),
        ledger: (report) => ledgerIdeaSpend(learn, userId, [report]),
      },
      { model, deadline: options.deadline },
    );
  }

  const linked = await rpc<number>('refresh_work_evidence', { p_user_id: userId });
  if (linked.error) throw new Error(`Linking ideas to work history failed: ${linked.error.message}`);

  return { passages: synced.data ?? 0, embedded, links: linked.data ?? 0 };
}
