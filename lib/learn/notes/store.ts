import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  notesForCard,
  NOTE_SELECT,
  toCardNote,
  type CardNote,
  type CardNoteRow,
} from './notes';

/**
 * Reading and writing notes through the person's own session. RLS limits
 * every read and write to their own rows, and the composite foreign keys stop
 * a note being pinned to another account's card or idea.
 */

/**
 * The notes each card shows, by card id: those written on it and those on
 * its idea. A card with none is absent from the map.
 */
export async function loadNotesForCards(
  supabase: LearnSupabaseClient,
  cards: readonly { id: string; conceptId: string | null }[],
): Promise<Map<string, CardNote[]>> {
  const byCard = new Map<string, CardNote[]>();
  if (cards.length === 0) return byCard;

  const cardIds = cards.map((card) => card.id);
  const conceptIds = [...new Set(cards.flatMap((card) => card.conceptId ?? []))];
  const filter = [`card_id.in.(${cardIds.join(',')})`];
  if (conceptIds.length > 0) filter.push(`concept_id.in.(${conceptIds.join(',')})`);

  const { data, error } = await supabase
    .from('card_notes')
    .select(NOTE_SELECT)
    .or(filter.join(','))
    .order('created_at');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading your notes failed: ${error.message}`);

  const notes = ((data ?? []) as CardNoteRow[]).map(toCardNote);
  for (const card of cards) {
    const shown = notesForCard(notes, card);
    if (shown.length > 0) byCard.set(card.id, shown);
  }
  return byCard;
}

/** Every note on one idea, oldest first, wherever it was written. */
export async function loadConceptNotes(
  supabase: LearnSupabaseClient,
  conceptId: string,
): Promise<CardNote[]> {
  const { data, error } = await supabase
    .from('card_notes')
    .select(NOTE_SELECT)
    .eq('concept_id', conceptId)
    .order('created_at');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading your notes failed: ${error.message}`);
  return ((data ?? []) as CardNoteRow[]).map(toCardNote);
}

/**
 * Keeps a note written on a card, against the card and its idea. Null when
 * the card is not there, or not yours.
 */
export async function insertCardNote(
  supabase: LearnSupabaseClient,
  userId: string,
  cardId: string,
  body: string,
): Promise<CardNote | null> {
  const { data: card, error: readError } = await supabase
    .from('feed_cards')
    .select('id, concept_id')
    .eq('id', cardId)
    .maybeSingle();
  assertSchemaExposed(readError, LEARN_SCHEMA);
  if (readError) throw new Error(`Reading that card failed: ${readError.message}`);
  if (!card) return null;

  return insertNote(supabase, {
    user_id: userId,
    card_id: card.id as string,
    concept_id: (card.concept_id as string | null) ?? null,
    body,
  });
}

/** Keeps a note written on an idea's own page. Null when the idea is not there, or not yours. */
export async function insertConceptNote(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptId: string,
  body: string,
): Promise<CardNote | null> {
  const { data: concept, error: readError } = await supabase
    .from('concepts')
    .select('id')
    .eq('id', conceptId)
    .maybeSingle();
  assertSchemaExposed(readError, LEARN_SCHEMA);
  if (readError) throw new Error(`Reading that idea failed: ${readError.message}`);
  if (!concept) return null;

  return insertNote(supabase, { user_id: userId, card_id: null, concept_id: conceptId, body });
}

async function insertNote(
  supabase: LearnSupabaseClient,
  row: { user_id: string; card_id: string | null; concept_id: string | null; body: string },
): Promise<CardNote> {
  const { data, error } = await supabase
    .from('card_notes')
    .insert(row)
    .select(NOTE_SELECT)
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Keeping that note failed: ${error.message}`);
  return toCardNote(data as CardNoteRow);
}

/** Deletes one note. False when it was already gone, or not yours. */
export async function deleteNote(supabase: LearnSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from('card_notes').delete().eq('id', id).select('id');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Deleting that note failed: ${error.message}`);
  return (data ?? []).length > 0;
}
