import 'server-only';

import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { FeedCard } from '@/lib/learn/feed/card';
import { VAULT_SCHEMA, type VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import {
  relatedNotes,
  relatedNotesForStored,
  toLink,
  type RelatedNoteLink,
} from '@/lib/vault/notes/related';

/**
 * Your notes nearest each Learn now card (plan #1113, under #1110).
 *
 * A card whose idea was saved as a concept uses the concept's stored vector
 * (learn.concepts.embedding, the same model and input type as the notes), so
 * it costs one obsidian.nearest_notes call and no embedding. A card with no
 * concept vector, which in September 2026 was about two cards in three, is
 * matched on its own words instead: title, takeaway and summary. That text is
 * embedded once and kept by its hash (obsidian.text_embeddings), so the card
 * costs a call the first time it is dealt and a read after that.
 *
 * Unit checks and teach-backs get none: they are questions about an idea, and
 * the card on screen shows no material for a note to sit beside.
 *
 * Never throws. A failed read leaves the cards without notes.
 */

type CardText = Pick<FeedCard, 'id' | 'kind' | 'title' | 'takeaway' | 'summary'>;

/** The words a card without a concept vector is matched on. */
export function cardMatchText(card: CardText): string {
  return [card.title, card.takeaway, card.summary].filter(Boolean).join('\n');
}

export async function relatedNotesForCards(
  supabase: LearnSupabaseClient,
  userId: string,
  cards: readonly CardText[],
): Promise<Map<string, RelatedNoteLink[]>> {
  const shown = cards.filter((card) => card.kind === 'section' || card.kind === 'lesson');
  if (shown.length === 0) return new Map();
  const vault = supabase.schema(VAULT_SCHEMA) as unknown as VaultSupabaseClient;
  const core = supabase.schema(CORE_SCHEMA) as unknown as CoreSupabaseClient;

  try {
    const { data: rows, error } = await supabase
      .from('feed_cards')
      .select('id, concept_id')
      .in(
        'id',
        shown.map((card) => card.id),
      );
    if (error) throw new Error(error.message);
    const conceptOf = new Map(
      ((rows ?? []) as { id: string; concept_id: string | null }[]).map((row) => [
        row.id,
        row.concept_id,
      ]),
    );

    const conceptIds = [...new Set([...conceptOf.values()].filter((id): id is string => !!id))];
    const vectors = new Map<string, { embedding: unknown; model: string | null }>();
    if (conceptIds.length > 0) {
      const { data, error: conceptError } = await supabase
        .from('concepts')
        .select('id, embedding, embedding_model')
        .in('id', conceptIds)
        .not('embedding', 'is', null);
      if (conceptError) throw new Error(conceptError.message);
      for (const row of (data ?? []) as {
        id: string;
        embedding: unknown;
        embedding_model: string | null;
      }[]) {
        vectors.set(row.id, { embedding: row.embedding, model: row.embedding_model });
      }
    }

    const withVector = shown.flatMap((card) => {
      const concept = conceptOf.get(card.id);
      const vector = concept ? vectors.get(concept) : undefined;
      return vector ? [{ key: card.id, ...vector }] : [];
    });
    const byText = shown.filter((card) => !withVector.some((v) => v.key === card.id));

    const [stored, matched] = await Promise.all([
      relatedNotesForStored(vault, userId, withVector),
      Promise.all(
        byText.map(async (card) => {
          const notes = await relatedNotes(vault, userId, cardMatchText(card), { core });
          return [card.id, notes.map(toLink)] as const;
        }),
      ),
    ]);
    return new Map([...stored, ...matched]);
  } catch (error) {
    console.error('[learn related notes]', error instanceof Error ? error.message : error);
    return new Map();
  }
}
