import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { PhraseExplanation } from './explain-phrase';

/**
 * Explanations of phrases selected on Learn now cards, in
 * `learn.phrase_explanations` (plan #1057), read and written through the
 * person's own session. RLS keeps every row to its owner, and the foreign key
 * on (card_id, user_id) keeps a row to a card of theirs.
 */

export type StoredExplanation = PhraseExplanation & {
  id: string;
  phrase: string;
  /** The card Make it a card wrote from this phrase, once it has. */
  madeCardId: string | null;
};

type Row = {
  id: string;
  phrase: string;
  explanation: string;
  article: string | null;
  section: string | null;
  made_card_id: string | null;
};

const COLUMNS = 'id, phrase, explanation, article, section, made_card_id';

function toStored(row: Row): StoredExplanation {
  return {
    id: row.id,
    phrase: row.phrase,
    explanation: row.explanation,
    article: row.article,
    section: row.section,
    madeCardId: row.made_card_id,
  };
}

/**
 * The explanation of this phrase on this card, whatever its case, or null.
 *
 * A card holds a handful of these at most, so they are read whole and matched
 * here: PostgREST cannot filter on lower(phrase), and an ilike would read a
 * `%` or `_` in the phrase as a wildcard.
 */
export async function loadExplanation(
  learn: LearnSupabaseClient,
  cardId: string,
  phrase: string,
): Promise<StoredExplanation | null> {
  const { data, error } = await learn.from('phrase_explanations').select(COLUMNS).eq('card_id', cardId);
  if (error) throw new Error(`Reading the explanations on that card failed: ${error.message}`);
  const wanted = phrase.toLowerCase();
  const row = ((data ?? []) as Row[]).find((candidate) => candidate.phrase.toLowerCase() === wanted);
  return row ? toStored(row) : null;
}

/**
 * Keep an explanation. Two presses racing on the same phrase both pay for the
 * call; the second insert is refused by the unique index, and the first
 * explanation is the one kept and returned.
 */
export async function saveExplanation(
  learn: LearnSupabaseClient,
  userId: string,
  input: { cardId: string; phrase: string; model: string } & PhraseExplanation,
): Promise<StoredExplanation> {
  const { data, error } = await learn
    .from('phrase_explanations')
    .insert({
      user_id: userId,
      card_id: input.cardId,
      phrase: input.phrase,
      explanation: input.explanation,
      article: input.article,
      section: input.section,
      model: input.model,
    })
    .select(COLUMNS)
    .single();
  if (error?.code === '23505') {
    const kept = await loadExplanation(learn, input.cardId, input.phrase);
    if (kept) return kept;
  }
  if (error || !data) throw new Error(`Keeping the explanation failed: ${error?.message ?? 'no row'}`);
  return toStored(data as Row);
}

/** Record the card Make it a card wrote, so a second press names it. */
export async function setMadeCard(
  learn: LearnSupabaseClient,
  explanationId: string,
  cardId: string,
): Promise<void> {
  const { error } = await learn
    .from('phrase_explanations')
    .update({ made_card_id: cardId })
    .eq('id', explanationId);
  if (error) throw new Error(`Recording the card that was made failed: ${error.message}`);
}
