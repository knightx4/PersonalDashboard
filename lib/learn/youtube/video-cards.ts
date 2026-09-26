/**
 * Which Learn now cards the videos in the card pile should have (plan #1067).
 *
 * The judge (#1066) gives a card-pile video one to five stretches, each a
 * point with its start and end seconds. Each stretch becomes one card, written
 * from the transcript segments it covers by the same writer an article section
 * goes through (write-card.ts), and stored in learn.feed_cards with reason
 * 'video' and the stretch's start. That start is the card's key: a unique
 * index on (user_id, video_id, video_start_seconds) means a stretch is written
 * once, however often the pass runs.
 *
 * A video leaves the card pile when you move it to watch or skip (#1068),
 * when you take it off the playlist, or when its stretches change. Its cards
 * nobody has done anything with yet (ready, or skipped once) are set aside as
 * dropped with WITHDRAWN as the reason; a card you saved, tested, marked or
 * asked to work on stays, because what you did with it is yours. If the video
 * comes back to the pile, the withdrawn cards come back as they were, with no
 * second model call.
 *
 * Pure: the run that reads and writes the rows is inngest/learn/video-cards.ts.
 */

import { clockTime } from './format';

/** One part of a video the judge found worth a card. */
export type Stretch = { startSeconds: number; endSeconds: number; point: string };

/** A video in someone's card pile, with what the cards need from its catalogue row. */
export type PileVideo = {
  userId: string;
  videoId: string;
  itemId: string;
  title: string;
  channel: string | null;
  stretches: Stretch[];
};

/** A video card already stored. */
export type StoredVideoCard = {
  id: string;
  userId: string;
  videoId: string;
  startSeconds: number;
  status: string;
  dropReason: string | null;
  hasSummary: boolean;
};

/** The drop reason on a card set aside because its video left the card pile. */
export const WITHDRAWN = 'The video left the card pile.';

/**
 * Cards set aside when their video leaves the pile: the ones nobody has acted
 * on. A card you saved, tested, marked known or asked to work on is kept.
 */
export const WITHDRAWABLE: readonly string[] = ['ready', 'skipped'];

/** Transcript under this many characters is too little to write a card from. */
export const MIN_STRETCH_CHARS = 300;

/** The stretches column, read defensively: anything malformed is left out. */
export function readStretches(value: unknown): Stretch[] {
  if (!Array.isArray(value)) return [];
  const out: Stretch[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const { startSeconds, endSeconds, point } = raw as Record<string, unknown>;
    if (typeof startSeconds !== 'number' || typeof endSeconds !== 'number' || typeof point !== 'string') continue;
    const start = Math.max(0, Math.floor(startSeconds));
    const end = Math.ceil(endSeconds);
    if (end <= start || !point.trim()) continue;
    // Two stretches with one start are one card.
    if (out.some((kept) => kept.startSeconds === start)) continue;
    out.push({ startSeconds: start, endSeconds: end, point: point.trim() });
  }
  return out;
}

/** "12:04 to 15:30": the stretch as the card's source line and the writer name it. */
export function stretchLabel(stretch: Pick<Stretch, 'startSeconds' | 'endSeconds'>): string {
  return `${clockTime(stretch.startSeconds)} to ${clockTime(stretch.endSeconds)}`;
}

export type CardJob = {
  video: PileVideo;
  stretch: Stretch;
  /** The stretch's place in the list, stored as the card's idea_index. */
  index: number;
  /** Set when an earlier run claimed the stretch and its card is still unwritten. */
  cardId?: string;
};

export type VideoCardPlan = {
  /** Stretches with no card yet, or whose card was claimed and never written. */
  write: CardJob[];
  /** Withdrawn cards whose video is back in the pile with the same stretch. */
  revive: string[];
  /** Unacted cards whose video or stretch is no longer in the pile. */
  withdraw: string[];
};

const key = (userId: string, videoId: string, start: number) => `${userId}|${videoId}|${start}`;

/**
 * What to do, given the pile and every video card stored.
 *
 * A stored card in `picked` was claimed by an earlier run whose writing call
 * failed or ran out of time, so it is written again. A dropped card the
 * writer turned down is left alone, so the same stretch is not paid for twice.
 */
export function planVideoCards(pile: PileVideo[], stored: StoredVideoCard[]): VideoCardPlan {
  const byKey = new Map(stored.map((card) => [key(card.userId, card.videoId, card.startSeconds), card]));
  const wanted = new Set<string>();
  const plan: VideoCardPlan = { write: [], revive: [], withdraw: [] };

  for (const video of pile) {
    video.stretches.forEach((stretch, index) => {
      const k = key(video.userId, video.videoId, stretch.startSeconds);
      wanted.add(k);
      const card = byKey.get(k);
      if (!card) plan.write.push({ video, stretch, index });
      else if (card.status === 'picked') plan.write.push({ video, stretch, index, cardId: card.id });
      else if (card.status === 'dropped' && card.dropReason === WITHDRAWN && card.hasSummary) plan.revive.push(card.id);
    });
  }

  for (const card of stored) {
    if (wanted.has(key(card.userId, card.videoId, card.startSeconds))) continue;
    if (WITHDRAWABLE.includes(card.status)) plan.withdraw.push(card.id);
  }
  return plan;
}

/** A transcript segment of the video, as the catalogue holds it. */
export type TimedSegment = { id: string; start: number | null; end: number | null; text: string };

/**
 * The transcript a stretch covers, and the segment it starts in.
 *
 * Every segment that overlaps the stretch, in order, joined. The card's
 * segment is the one the stretch starts in, or the first it overlaps. Null
 * when no segment overlaps, or when what they hold is too thin to write from:
 * a video judged from its chapters has chapter titles, not a transcript, and a
 * card written from a title would be made up.
 */
export function stretchText(
  segments: TimedSegment[],
  stretch: Pick<Stretch, 'startSeconds' | 'endSeconds'>,
): { segmentId: string; text: string } | null {
  const ordered = segments
    .filter((segment) => segment.start !== null)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const overlapping = ordered.filter((segment, index) => {
    const start = segment.start ?? 0;
    const end = segment.end ?? ordered[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    return start < stretch.endSeconds && end > stretch.startSeconds;
  });
  if (overlapping.length === 0) return null;
  const text = overlapping
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n\n');
  if (text.length < MIN_STRETCH_CHARS) return null;
  const home = overlapping.find((segment) => (segment.start ?? 0) <= stretch.startSeconds) ?? overlapping[0]!;
  return { segmentId: home.id, text };
}
