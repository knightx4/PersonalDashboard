import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { relatedNotesStore, vectorForText } from '@/lib/vault/notes/related';
import { BIG_FIVE_FACTORS, type BigFiveFactor, type BigFiveScores } from './ipip';
import {
  CANDIDATES_PER_TRAIT,
  shareOutThemes,
  traitSentences,
  type ThemeCandidate,
  type TraitThemes,
} from './trait-themes';

/**
 * The vault themes closest to each of your traits (plan #1634), for the Know
 * page. See trait-themes.ts for how they are chosen.
 *
 * The trait sentences are embedded through the related-notes cache, so each
 * is embedded once per person and kept by its hash; the cost goes on the
 * ledger as 'embed-note-match', the same call. The comparison is one call to
 * obsidian.nearest_themes per trait, against the themes embedded with the
 * same model.
 *
 * Returns null when it could not be worked out: no embedding key, a failed
 * call or a failed read. The page then says the themes could not be matched
 * and still shows the traits.
 */
export async function loadTraitThemes(
  vault: VaultSupabaseClient,
  userId: string,
  scores: BigFiveScores,
  options: { core?: Pick<CoreSupabaseClient, 'from'> | null } = {},
): Promise<TraitThemes | null> {
  try {
    const ports = relatedNotesStore(vault, userId, { core: options.core ?? null });
    const sentences = traitSentences(scores);
    const found = await Promise.all(
      BIG_FIVE_FACTORS.map(async (factor): Promise<[BigFiveFactor, ThemeCandidate[]]> => {
        const vector = await vectorForText(ports, sentences[factor]);
        if (!vector) throw new Error('no vector for a trait sentence');
        const { data, error } = await vault.rpc('nearest_themes', {
          query_embedding: vectorLiteral(vector.vector),
          p_user_id: userId,
          match_limit: CANDIDATES_PER_TRAIT,
          embedding_model_filter: vector.model,
        });
        if (error) throw new Error(`Finding themes near a trait failed: ${error.message}`);
        return [factor, (data ?? []) as ThemeCandidate[]];
      }),
    );
    return shareOutThemes(Object.fromEntries(found) as Record<BigFiveFactor, ThemeCandidate[]>);
  } catch (error) {
    console.error('[learn personality themes]', error instanceof Error ? error.message : error);
    return null;
  }
}
