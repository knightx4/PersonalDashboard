import 'server-only';

import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';

/**
 * The embedding an idea is saved with (plan #1853).
 *
 * Every route that writes a row to learn.concepts embeds its claims here and
 * spreads the result into the same insert, so an idea has its vector the
 * moment it exists. The Learn now feed embeds its own claims in
 * lib/learn/feed/ideas-store.ts, because it needs the vectors before saving
 * to drop a copy of an idea already held; everything else comes here.
 *
 * The claim alone is embedded, as the feed does, so every vector in the
 * column answers the same question and `nearest_concepts` compares like with
 * like.
 *
 * Never throws. A failed call leaves both columns null and the idea is saved
 * anyway; the daily sweep fills it in later (plan #1854).
 */

/** The ledger line, under learn in core.model_spend. */
export const EMBED_IDEA_OPERATION = 'embed-idea';

/** The two columns, ready to spread into a concepts insert or update. */
export type IdeaEmbedding = { embedding: string | null; embedding_model: string | null };

const NONE: IdeaEmbedding = { embedding: null, embedding_model: null };

function warn(action: string, detail: unknown): void {
  console.error(`[learn idea embedding] ${action}`, detail instanceof Error ? detail.message : detail);
}

/**
 * One embedding per claim, in the order given.
 *
 * `learn` is whichever client is writing the ideas, the person's session or
 * the service role, and the spend row goes in through it under the owner.
 */
export async function embedIdeaClaims(
  learn: LearnSupabaseClient,
  userId: string,
  claims: readonly string[],
): Promise<IdeaEmbedding[]> {
  const none = claims.map(() => NONE);
  if (claims.length === 0) return none;

  const reports: SpendReport[] = [];
  try {
    const embedded = await embedTexts({
      texts: [...claims],
      inputType: 'document',
      onSpend: (report) => reports.push(report),
    });
    if (!embedded.ok) {
      // No key is the ordinary answer on a machine without one, and the
      // sweep is what fills these in; it is not worth a line per write.
      if (embedded.reason !== 'no-key') warn('embedding the claims', embedded.detail);
      return none;
    }
    return embedded.vectors.map((vector) => ({
      embedding: vectorLiteral(vector),
      embedding_model: embedded.model,
    }));
  } catch (error) {
    warn('embedding the claims', error);
    return none;
  } finally {
    await ledgerIdeaSpend(learn, userId, reports);
  }
}

/** The embedding for one claim. */
export async function embedIdeaClaim(
  learn: LearnSupabaseClient,
  userId: string,
  claim: string,
): Promise<IdeaEmbedding> {
  const [one] = await embedIdeaClaims(learn, userId, [claim]);
  return one ?? NONE;
}

async function ledgerIdeaSpend(
  learn: LearnSupabaseClient,
  userId: string,
  reports: SpendReport[],
): Promise<void> {
  if (reports.length === 0) return;
  try {
    const core = learn.schema(CORE_SCHEMA) as unknown as CoreSupabaseClient;
    for (const report of reports) {
      await recordSpend(core, userId, {
        module: 'learn',
        operation: EMBED_IDEA_OPERATION,
        model: report.model,
        usage: report.usage,
      });
    }
  } catch (error) {
    warn('recording what the embedding cost', error);
  }
}
