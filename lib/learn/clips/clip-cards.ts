/**
 * What a saved clip's Learn now card is written from (plan #1405).
 *
 * Saving a clip on the Clips page queues a card: the hourly feed top-up finds
 * every saved clip with no card yet (clip-card-run.ts) and writes one through
 * the same writer a card-pile stretch goes through. The card is a video card
 * (reason 'video') with the clip's id in clip_id, so it plays the video from
 * the clip's start and the pile pass leaves it alone.
 *
 * The writer reads the clip's own words, taken from the timed transcript
 * lines, not the four-and-a-half-minute catalogue segment the clip sits in:
 * that window holds several points, and the card is about one. The segment is
 * still the card's segment_id, which saving, Test me and Ask need.
 *
 * Pure: the run that reads and writes the rows is clip-card-run.ts.
 */

import type { TranscriptCue } from '@/lib/learn/catalogue/segment';

/**
 * Clip words under this many characters are too few to write a card from.
 * Lower than a stretch's 300 because a clip runs 20 to 90 seconds: twenty
 * seconds of speech is about 300 characters, and a caption-only clip is the
 * case this keeps out.
 */
export const MIN_CLIP_CHARS = 150;

/**
 * idea_index is unique per person and segment, and runs 0 to 9. Article
 * sections use 0 to 2 and card-pile stretches their place in the list, 0 to
 * 4, so a clip takes the highest free index and leaves the low ones for them.
 */
export const MAX_IDEA_INDEX = 9;

/** A saved clip, with what its card needs. */
export type SavedClip = {
  id: string;
  userId: string;
  videoId: string;
  itemId: string;
  startSeconds: number;
  endSeconds: number;
  caption: string;
  idea: string | null;
};

/** The point the card is about: the clip's idea, or its caption where the cutter wrote none. */
export function clipPoint(clip: Pick<SavedClip, 'caption' | 'idea'>): string {
  return clip.idea?.trim() || clip.caption.trim();
}

/** A video card already stored, as the run reads it. */
export type StoredClipCard = {
  id: string;
  userId: string;
  videoId: string;
  startSeconds: number;
  clipId: string | null;
  status: string;
};

export type ClipCardJob = {
  clip: SavedClip;
  /** Set when an earlier run claimed the clip and its card is still unwritten. */
  cardId?: string;
};

/**
 * The saved clips that need writing. A clip with a card is done, unless that
 * card is still picked, when an earlier run's write failed and it is written
 * again. A clip starting at the same second as a card-pile stretch of the
 * same video already has a card that opens there, and gets no second one.
 */
export function planClipCards(saved: SavedClip[], stored: StoredClipCard[]): ClipCardJob[] {
  const byClip = new Map<string, StoredClipCard>();
  const starts = new Set<string>();
  for (const card of stored) {
    if (card.clipId) byClip.set(card.clipId, card);
    starts.add(`${card.userId}|${card.videoId}|${card.startSeconds}`);
  }
  const jobs: ClipCardJob[] = [];
  for (const clip of saved) {
    const card = byClip.get(clip.id);
    if (card) {
      if (card.status === 'picked') jobs.push({ clip, cardId: card.id });
      continue;
    }
    if (starts.has(`${clip.userId}|${clip.videoId}|${clip.startSeconds}`)) continue;
    jobs.push({ clip });
  }
  return jobs;
}

/**
 * The words said during the clip: every transcript line that overlaps it,
 * joined. A line with no end runs to the next line's start. Null when they
 * come to too little to write from.
 */
export function clipText(
  cues: readonly TranscriptCue[],
  clip: Pick<SavedClip, 'startSeconds' | 'endSeconds'>,
): string | null {
  const ordered = cues.filter((cue) => cue.startSeconds >= 0).sort((a, b) => a.startSeconds - b.startSeconds);
  const words = ordered
    .filter((cue, index) => {
      const end = cue.endSeconds ?? ordered[index + 1]?.startSeconds ?? cue.startSeconds + 2;
      return cue.startSeconds < clip.endSeconds && end > clip.startSeconds;
    })
    .map((cue) => cue.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  return words.length >= MIN_CLIP_CHARS ? words : null;
}

/** A catalogue segment of the video, by its start and end. */
export type SegmentSpan = { id: string; start: number | null; end: number | null };

/**
 * The catalogue segment the clip starts in: the last one starting at or
 * before the clip, or the first one when the clip starts before them all.
 * Null for a video with no timed segments.
 */
export function homeSegment(segments: readonly SegmentSpan[], startSeconds: number): string | null {
  const timed = segments.filter((segment) => segment.start !== null).sort((a, b) => a.start! - b.start!);
  if (timed.length === 0) return null;
  let home = timed[0]!;
  for (const segment of timed) if (segment.start! <= startSeconds) home = segment;
  return home.id;
}

/** The highest idea_index not yet used on the segment, or null when all ten are. */
export function freeIdeaIndex(used: ReadonlySet<number>): number | null {
  for (let index = MAX_IDEA_INDEX; index >= 0; index -= 1) if (!used.has(index)) return index;
  return null;
}
