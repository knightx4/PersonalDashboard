import type { IdeaEmbedding } from '@/lib/learn/embed/idea-embedding';

/**
 * A stand-in for lib/learn/embed/idea-embedding.ts, for the tests of the
 * routes that save a Learn idea. Each claim's "vector" names the claim, so a
 * test can see that every row was saved with its own.
 *
 *   vi.mock('@/lib/learn/embed/idea-embedding', () => import('@/tests/stubs/idea-embedding'));
 */

export const EMBED_IDEA_OPERATION = 'embed-idea';

export const fakeIdeaVector = (claim: string): IdeaEmbedding => ({
  embedding: `vector of ${claim.trim()}`,
  embedding_model: 'voyage-4-lite',
});

export async function embedIdeaClaims(
  _learn: unknown,
  _userId: string,
  claims: readonly string[],
): Promise<IdeaEmbedding[]> {
  return claims.map(fakeIdeaVector);
}

export async function embedIdeaClaim(_learn: unknown, _userId: string, claim: string): Promise<IdeaEmbedding> {
  return fakeIdeaVector(claim);
}
