import type { CardToWrite } from '@/lib/learn/feed/write-card';

/**
 * Which of a brief's sources still need a Learn now card (plan #2023.6).
 *
 * A ready brief's sources are the readings it put on its list, each with the
 * summary the research run wrote of the page and, when the person gave one,
 * the page's own text. Each source becomes one card, reason 'researched',
 * written by the same writer as a section card from that text. This file
 * decides which to write and what the writer is handed; the run that reads
 * and writes the rows is inngest/learn/brief-cards.ts.
 *
 * Nothing here touches the database or the network.
 */

/** Characters of material below which a source is too thin to write a card from. */
export const MIN_SOURCE_CHARS = 120;

/** One source on a ready brief's list, as the card pass reads it. */
export type BriefSource = {
  readingId: string;
  userId: string;
  briefId: string;
  question: string;
  angle: string;
  title: string;
  /** The page's own text, when the person gave it. Read before the summary. */
  givenText: string | null;
  /** What the research run wrote of the page (summary_from 'link'). */
  summary: string | null;
};

/** A researched card already on record for a source. */
export type StoredBriefCard = { id: string; readingId: string; status: string };

/** A source to write, with the picked row a failed write left, if any. */
export type BriefCardJob = { source: BriefSource; cardId: string | null };

/** The text a source's card is written from, or null when there is too little. */
export function sourceText(source: Pick<BriefSource, 'givenText' | 'summary'>): string | null {
  const given = source.givenText?.trim() ?? '';
  if (given.length >= MIN_SOURCE_CHARS) return given;
  const summary = source.summary?.trim() ?? '';
  if (summary.length >= MIN_SOURCE_CHARS) return summary;
  return null;
}

/**
 * The sources to write a card for: each with text enough and no card yet,
 * and each whose card is still picked because an earlier write failed. A
 * source with a card written, dropped or acted on is left alone, so writing
 * a brief's cards again costs nothing.
 */
export function planBriefCards(sources: readonly BriefSource[], stored: readonly StoredBriefCard[]): BriefCardJob[] {
  const byReading = new Map(stored.map((card) => [card.readingId, card]));
  return sources.flatMap((source): BriefCardJob[] => {
    if (!sourceText(source)) return [];
    const card = byReading.get(source.readingId);
    if (!card) return [{ source, cardId: null }];
    return card.status === 'picked' ? [{ source, cardId: card.id }] : [];
  });
}

/** What the card writer is given for one source. Null when the source has too little text. */
export function briefCardToWrite(source: BriefSource, cardId: string): CardToWrite | null {
  const text = sourceText(source);
  if (!text) return null;
  return {
    id: cardId,
    segmentId: null,
    reason: 'researched',
    themeName: null,
    aimName: null,
    field: null,
    gap: null,
    article: source.title,
    section: null,
    text,
    depth: null,
    research: { question: source.question, angle: source.angle, source: source.title },
    maxIdeas: 1,
  };
}

/**
 * The statuses a card in a brief's quick read can have: written, and not
 * dismissed. Dismissing a card in Learn now takes it out of the quick read
 * as well, since both read the one row.
 */
export const QUICK_READ_STATUSES = ['ready', 'opened', 'saved', 'review', 'skipped', 'known', 'tested'] as const;

/**
 * A brief's cards in the order its reading list has their sources, so the
 * quick read follows the list. A card whose source is not on the list goes
 * last, in the order it came.
 */
export function orderQuickRead<T extends { readingId: string | null }>(
  cards: readonly T[],
  readingOrder: readonly string[],
): T[] {
  const place = new Map(readingOrder.map((id, index) => [id, index]));
  const at = (card: T) => (card.readingId !== null ? (place.get(card.readingId) ?? Infinity) : Infinity);
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const byPlace = at(a.card) - at(b.card);
      return Number.isNaN(byPlace) || byPlace === 0 ? a.index - b.index : byPlace;
    })
    .map(({ card }) => card);
}
