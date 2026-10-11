import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { writeClipNote, type ClipNoteInput, type ClipNoteResult } from './clip-note';
import { VIDEO_MIN_SIMILARITY } from './load';

/**
 * Writing "In this video" for the ready cards that have a lecture clip
 * (note cde86a10), from the hourly feed top-up.
 *
 * The clip is the segment video_clips_for_concepts finds nearest the card's
 * idea, the same call the deal makes, so the note is written about the clip
 * the card will play. A card whose note was written about another segment
 * gets a new one. A card written from a video plays its own stretch and is
 * about it already, so it gets none.
 *
 * A few cards a run, oldest first: the deck holds about twenty ready cards and
 * most have no clip, so the backlog clears in a run or two and then it is the
 * new cards each hour. A failed write leaves the card as it was, and the next
 * run tries it again.
 */

/** The most notes one person gets in one run. */
export const CLIP_NOTES_PER_RUN = 8;

export type ClipNotePassResult = { written: number; failed: number };

type ReadyRow = {
  id: string;
  concept_id: string;
  idea_name: string | null;
  takeaway: string | null;
  summary: string | null;
  named_article: string | null;
  clip_note_segment_id: string | null;
};

type MatchRow = { concept_id: string; segment_id: string; item_title: string };

/** The ready cards whose clip has no note yet, with what each note is written from. Pure. */
export function notesDue(
  cards: readonly ReadyRow[],
  matches: readonly MatchRow[],
  limit: number,
): { card: ReadyRow; segmentId: string; video: string }[] {
  const byConcept = new Map(matches.map((match) => [match.concept_id, match]));
  return cards
    .flatMap((card) => {
      const match = byConcept.get(card.concept_id);
      if (!match || match.segment_id === card.clip_note_segment_id) return [];
      return [{ card, segmentId: match.segment_id, video: match.item_title }];
    })
    .slice(0, limit);
}

/** One person's pass. Throws only when the cards or their clips cannot be read. */
export async function writeClipNotes(
  learn: LearnSupabaseClient,
  userId: string,
  options: {
    apiKey: string;
    deadline: number;
    onSpend: (reports: SpendReport[]) => Promise<void>;
    /** The writer; writeClipNote outside a test. */
    write?: (input: ClipNoteInput & { anthropicApiKey: string; onSpend: (report: SpendReport) => void }) => Promise<ClipNoteResult>;
  },
): Promise<ClipNotePassResult> {
  const result: ClipNotePassResult = { written: 0, failed: 0 };
  const { data: cardData, error: cardError } = await learn
    .from('feed_cards')
    .select('id, concept_id, idea_name, takeaway, summary, named_article, clip_note_segment_id')
    .eq('user_id', userId)
    .eq('status', 'ready')
    .is('video_id', null)
    .not('concept_id', 'is', null)
    .order('created_at')
    .limit(50);
  if (cardError) throw new Error(`Reading the ready cards failed: ${cardError.message}`);
  const cards = (cardData ?? []) as ReadyRow[];
  if (cards.length === 0) return result;

  const { data: matchData, error: matchError } = await learn.rpc('video_clips_for_concepts', {
    concept_ids: [...new Set(cards.map((card) => card.concept_id))],
    min_similarity: VIDEO_MIN_SIMILARITY,
  });
  if (matchError) throw new Error(`Finding the cards' clips failed: ${matchError.message}`);
  const due = notesDue(cards, (matchData ?? []) as MatchRow[], CLIP_NOTES_PER_RUN);

  const write = options.write ?? writeClipNote;
  for (const { card, segmentId, video } of due) {
    if (Date.now() >= options.deadline) break;
    const { data: segment, error: segmentError } = await learn
      .from('catalogue_segments')
      .select('text')
      .eq('id', segmentId)
      .maybeSingle();
    const text = (segment as { text: string | null } | null)?.text?.trim();
    if (segmentError || !text) {
      result.failed += 1;
      continue;
    }
    const reports: SpendReport[] = [];
    const note = await write({
      idea: card.idea_name?.trim() || card.named_article?.trim() || 'this idea',
      claim: card.takeaway?.trim() || card.summary?.trim() || '',
      video,
      text,
      anthropicApiKey: options.apiKey,
      onSpend: (report) => reports.push(report),
    });
    await options.onSpend(reports);
    if (!note.ok) {
      result.failed += 1;
      console.error('[clip notes]', card.id, note.detail);
      continue;
    }
    const { error } = await learn
      .from('feed_cards')
      .update({ clip_note_segment_id: segmentId, clip_said: note.said, clip_why: note.why })
      .eq('id', card.id)
      .eq('user_id', userId);
    if (error) {
      result.failed += 1;
      console.error('[clip notes]', card.id, error.message);
    } else {
      result.written += 1;
    }
  }
  return result;
}
