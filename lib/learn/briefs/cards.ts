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
 * Once a topic drafted from the brief is approved under a goal (plan
 * #2184.1), the brief belongs to that goal: its cards carry the goal, and
 * each answered sub-question becomes a card of its own as well, written from
 * the brief's section (Dash's answer and the words it quotes) rather than
 * from one page. Those are the next cards on the goal.
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
  /** The goal the brief is under, once a topic from it is approved (plan #2184.1). */
  aim?: { id: string; name: string } | null;
  /**
   * For a card written from one of the brief's sections rather than from a
   * page: the sub-question, Dash's answer and the quoted words. `readingId`
   * is then the first page the section quotes and `title` that page's.
   */
  section?: BriefSectionMaterial | null;
  /** 0 for a page's card; SECTION_IDEA_BASE plus the section's place for a section's. */
  ideaIndex?: number;
};

/** One answered sub-question as a card's material. */
export type BriefSectionMaterial = {
  subQuestion: string;
  position: string;
  quotes: { quote: string; title: string }[];
};

/**
 * Section cards sit on their first quoted page's row at this idea index and
 * up, clear of the page's own card (index 0, one idea), within the column's
 * 0 to 9.
 */
export const SECTION_IDEA_BASE = 5;
const MAX_SECTION_CARDS = 10 - SECTION_IDEA_BASE;

/** A researched card already on record for a source. */
export type StoredBriefCard = { id: string; readingId: string; status: string; ideaIndex?: number };

/** A source to write, with the picked row a failed write left, if any. */
export type BriefCardJob = { source: BriefSource; cardId: string | null };

/** A section as the text its card is written from. */
export function sectionText(section: BriefSectionMaterial): string {
  const lines = [`Dash's answer to “${section.subQuestion.trim()}”: ${section.position.trim()}`];
  if (section.quotes.length > 0) {
    lines.push('', 'Quoted from the sources:', ...section.quotes.map((q) => `“${q.quote.trim()}” (${q.title.trim()})`));
  }
  return lines.join('\n');
}

/** The text a source's card is written from, or null when there is too little. */
export function sourceText(source: Pick<BriefSource, 'givenText' | 'summary' | 'section'>): string | null {
  if (source.section) {
    const text = sectionText(source.section);
    return text.length >= MIN_SOURCE_CHARS ? text : null;
  }
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
  const key = (readingId: string, ideaIndex: number | undefined) => `${readingId}:${ideaIndex ?? 0}`;
  const byReading = new Map(stored.map((card) => [key(card.readingId, card.ideaIndex), card]));
  return sources.flatMap((source): BriefCardJob[] => {
    if (!sourceText(source)) return [];
    const card = byReading.get(key(source.readingId, source.ideaIndex));
    if (!card) return [{ source, cardId: null }];
    return card.status === 'picked' ? [{ source, cardId: card.id }] : [];
  });
}

/**
 * The cards a brief under a goal adds: one per answered sub-question, in the
 * order the brief asks them, each on the first page its answer quotes. A
 * section that quotes no page has no row to sit on and is left out.
 */
export function briefSectionSources(
  brief: {
    id: string;
    userId: string;
    question: string;
    angle: string;
    aim: { id: string; name: string };
    subQuestions: readonly { id: string; text: string }[];
    sections: readonly { sub_question_id: string; position: string; citations: readonly { reading_id: string; quote: string }[] }[];
  },
  titles: ReadonlyMap<string, string>,
): BriefSource[] {
  const bySub = new Map(brief.sections.map((section) => [section.sub_question_id, section]));
  return brief.subQuestions.slice(0, MAX_SECTION_CARDS).flatMap((sub, index): BriefSource[] => {
    const section = bySub.get(sub.id);
    const quoted = section?.citations.filter((c) => titles.has(c.reading_id)) ?? [];
    if (!section || quoted.length === 0) return [];
    const first = quoted[0]!.reading_id;
    return [
      {
        readingId: first,
        userId: brief.userId,
        briefId: brief.id,
        question: brief.question,
        angle: brief.angle,
        title: titles.get(first)!,
        givenText: null,
        summary: null,
        aim: brief.aim,
        ideaIndex: SECTION_IDEA_BASE + index,
        section: {
          subQuestion: sub.text,
          position: section.position,
          quotes: quoted.map((c) => ({ quote: c.quote, title: titles.get(c.reading_id)! })),
        },
      },
    ];
  });
}

/** What the card writer is given for one source. Null when the source has too little text. */
export function briefCardToWrite(source: BriefSource, cardId: string): CardToWrite | null {
  const text = sourceText(source);
  if (!text) return null;
  const article = source.section ? `Your research: ${source.question.trim()}`.slice(0, 300) : source.title;
  return {
    id: cardId,
    segmentId: null,
    reason: 'researched',
    themeName: null,
    aimName: source.aim?.name ?? null,
    field: null,
    gap: null,
    article,
    section: null,
    text,
    depth: null,
    research: {
      question: source.section ? source.section.subQuestion : source.question,
      angle: source.angle,
      source: source.section ? `Dash's answer from the sources it read on “${source.question.trim()}”` : source.title,
    },
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
