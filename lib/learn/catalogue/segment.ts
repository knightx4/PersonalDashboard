import type { CatalogueSegmentInput } from './store';

/**
 * Cutting a lecture into the spans that get embedded.
 *
 * docs/LEARN-SOURCES-SPEC.md is direct about why a video is not one point:
 * offering a whole eighty-minute lecture as the answer to one claim is close
 * to useless, because the claim is covered in four minutes somewhere in the
 * middle and finding it is the work. So a video occupies a path across the
 * index rather than a position, and the addressable row is a span.
 *
 * Three ways a lecture gets cut, in the order they are preferred:
 *
 *   **A transcript**, cut at roughly three to six minutes on sentence ends,
 *   with about thirty seconds of overlap so a claim explained across a
 *   boundary is not lost by both neighbours. This is the one that retrieves
 *   well, because the text is what was actually said.
 *
 *   **The video's own chapter markers**, where it publishes them. A human
 *   already decided where the seams are, which beats any length rule. The
 *   text is only the chapter title, so it retrieves worse than a transcript
 *   and better than nothing.
 *
 *   **One segment for the whole video**, carrying its title and description.
 *   The spec calls this honest and says it should rank poorly, and it does:
 *   a few hundred words about an eighty-minute lecture loses to four minutes
 *   of the thing itself, which is the correct outcome.
 *
 * Everything here is pure. No network, no database, no provider import -- the
 * chapters arrive as an argument -- so the cut can be checked against a
 * transcript written by hand.
 */

/** One line of a transcript: when it was said, and what was said. */
export type TranscriptCue = {
  startSeconds: number;
  /** Null where the transcript gives no end; the next cue's start stands in. */
  endSeconds: number | null;
  text: string;
};

export type Chapter = {
  startSeconds: number;
  title: string;
};

export type VideoToSegment = {
  title: string;
  description: string;
  durationSeconds: number | null;
  chapters: Chapter[];
};

export type SegmentedVideo = {
  segments: CatalogueSegmentInput[];
  /** Which of the three ways above produced them. The sweep counts these. */
  cutBy: 'transcript' | 'chapters' | 'whole';
};

/** About four and a half minutes, inside the spec's three to six. */
const TARGET_SECONDS = 270;
const MIN_SECONDS = 180;
const MAX_SECONDS = 360;
const OVERLAP_SECONDS = 30;

/**
 * A description longer than this is a reading list, a transcript link and a
 * copyright notice rather than a description of the lecture. Capped because
 * this text is embedded and judged, and the tail of it is never the part
 * that speaks to a claim.
 */
const MAX_WHOLE_TEXT_CHARS = 4000;

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const SENTENCE_END = /[.!?…]["'”’)\]]?$/;

function endsSentence(text: string): boolean {
  return SENTENCE_END.test(tidy(text));
}

/**
 * When each cue stops.
 *
 * A transcript that gives no end times -- which is most of them -- is read as
 * each line running to the start of the next. The last line has nothing after
 * it, so it ends when it starts, and the segment holding it is stored
 * open-ended: `t_end_seconds` null, which `catalogue_segments` allows and
 * means "from here to the end of the work".
 */
function endsOf(cues: TranscriptCue[]): number[] {
  return cues.map((cue, index) => cue.endSeconds ?? cues[index + 1]?.startSeconds ?? cue.startSeconds);
}

/**
 * Cut a transcript into overlapping spans.
 *
 * The rule, in one pass: run forward from the first uncut line, remember the
 * last line that both ended a sentence and left the span at least three
 * minutes long, and cut there as soon as the span reaches the target. A span
 * that reaches six minutes without any sentence ending is cut anyway, because
 * a transcript with no punctuation is a real thing and an uncut one is one
 * segment for the whole lecture.
 *
 * Then step back into the span by thirty seconds to start the next one, which
 * is the overlap, and never back past the line after the one that started it,
 * so the walk cannot stall.
 *
 * The tail is absorbed rather than left: if everything remaining fits inside
 * the maximum, the current span takes all of it instead of leaving a
 * forty-second fragment that will never be the best answer to anything.
 */
export function segmentsFromCues(cues: TranscriptCue[]): CatalogueSegmentInput[] {
  const usable = cues.filter((cue) => tidy(cue.text) !== '' && cue.startSeconds >= 0);
  if (usable.length === 0) return [];

  const ends = endsOf(usable);
  const segments: CatalogueSegmentInput[] = [];

  let from = 0;
  while (from < usable.length) {
    const start = usable[from].startSeconds;

    // Everything left is short enough to be one span: take it and stop.
    let cut = usable.length - 1;
    if (ends[usable.length - 1] - start > MAX_SECONDS) {
      let sentence = -1;
      let index = from;
      for (; index < usable.length; index += 1) {
        const elapsed = ends[index] - start;
        if (elapsed >= MIN_SECONDS && endsSentence(usable[index].text)) sentence = index;
        if (elapsed >= TARGET_SECONDS && sentence >= 0) break;
        if (elapsed >= MAX_SECONDS) break;
      }
      cut = sentence >= 0 ? sentence : Math.min(index, usable.length - 1);
    }

    const end = ends[cut];
    segments.push({
      ordinal: segments.length,
      tStartSeconds: Math.round(start),
      tEndSeconds: end > start ? Math.round(end) : null,
      sectionAnchor: null,
      heading: null,
      text: usable
        .slice(from, cut + 1)
        .map((cue) => tidy(cue.text))
        .join(' '),
    });

    if (cut >= usable.length - 1) break;

    let next = cut + 1;
    while (next > from + 1 && usable[next - 1].startSeconds >= end - OVERLAP_SECONDS) next -= 1;
    from = next;
  }

  return segments;
}

/**
 * One span per chapter, each running to the next one.
 *
 * The text is the chapter title with the lecture's title in front of it. That
 * is not decoration: the segment text is the whole of what gets embedded and
 * what the judging pass reads, and "Row picture" on its own says nothing about
 * linear algebra while "Lecture 1: The Geometry of Linear Equations. Row
 * picture" says what it is about.
 */
export function segmentsFromChapters(
  chapters: Chapter[],
  video: { title: string; durationSeconds: number | null },
): CatalogueSegmentInput[] {
  const ordered = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
  const segments: CatalogueSegmentInput[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const chapter = ordered[index];
    const title = tidy(chapter.title);
    if (!title) continue;

    const after = ordered[index + 1]?.startSeconds ?? video.durationSeconds ?? null;
    const end = after !== null && after > chapter.startSeconds ? Math.round(after) : null;
    const heading = title;
    const lecture = tidy(video.title);

    segments.push({
      ordinal: segments.length,
      tStartSeconds: Math.round(chapter.startSeconds),
      tEndSeconds: end,
      sectionAnchor: null,
      heading,
      text: lecture && lecture !== title ? `${lecture}. ${title}` : title,
    });
  }

  return segments;
}

/**
 * The one segment a video with nothing else gets.
 *
 * No offsets and no anchor, which is the third address `catalogue_segments`
 * allows and what lib/learn/catalogue/queue.ts reads as `whole`: queuing it
 * opens the video at the start, because nothing here knows a better minute.
 */
export function wholeVideoSegment(video: { title: string; description: string }): CatalogueSegmentInput {
  const title = tidy(video.title);
  const description = tidy(video.description);
  const text = description ? `${title}\n\n${description}` : title;

  return {
    ordinal: 0,
    tStartSeconds: null,
    tEndSeconds: null,
    sectionAnchor: null,
    heading: null,
    text: text.slice(0, MAX_WHOLE_TEXT_CHARS),
  };
}

/** Transcript, else chapters, else the whole thing. */
export function segmentsForVideo(
  video: VideoToSegment,
  cues: TranscriptCue[] | null,
): SegmentedVideo {
  if (cues && cues.length > 0) {
    const segments = segmentsFromCues(cues);
    if (segments.length > 0) return { segments, cutBy: 'transcript' };
  }

  if (video.chapters.length > 0) {
    const segments = segmentsFromChapters(video.chapters, video);
    if (segments.length > 0) return { segments, cutBy: 'chapters' };
  }

  return { segments: [wholeVideoSegment(video)], cutBy: 'whole' };
}
