import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedIdeaClaim, type IdeaEmbedding } from '@/lib/learn/embed/idea-embedding';
import { rewriteClaimPatch, type ClaimPatch, type KeptClaim } from './rewrite';

/**
 * The update a rewritten claim is saved with: the patch `rewriteClaimPatch`
 * decides, and the new wording's embedding, so the vector on the row always
 * matches the sentence in `claim` (plan #1853).
 *
 * When the embedding call fails the old vector is cleared rather than kept,
 * because a vector for the replaced sentence would place the idea where it
 * no longer belongs; the daily sweep embeds the new wording instead.
 */
export async function rewrittenClaimUpdate(
  learn: LearnSupabaseClient,
  userId: string,
  current: KeptClaim,
  next: string,
): Promise<ClaimPatch & IdeaEmbedding> {
  const patch = rewriteClaimPatch(current, next);
  const vector = await embedIdeaClaim(learn, userId, patch.claim);
  return { ...patch, ...vector };
}
