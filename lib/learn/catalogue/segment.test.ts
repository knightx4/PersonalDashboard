import { describe, expect, it } from 'vitest';
import {
  segmentsForVideo,
  segmentsFromChapters,
  segmentsFromCues,
  wholeVideoSegment,
  type TranscriptCue,
} from '@/lib/learn/catalogue/segment';
import { locatorFor } from '@/lib/learn/catalogue/queue';

/**
 * Where a lecture gets cut.
 *
 * The step's acceptance is two of these: a lecture is cut into timed segments
 * that can be queued as clips, and a lecture whose transcript cannot be
 * reached gets one segment for the whole video rather than being skipped. The
 * rest are the properties the spec asks of the cut -- three to six minutes,
 * thirty seconds of overlap, sentence ends -- which are worth asserting
 * because none of them is visible in the rows afterwards.
 *
 * Transcripts are written here rather than fetched. The institution's site is
 * an adapter behind a port, and the cut does not know or care which one filled
 * it.
 */

/** A lecture of `seconds`, one cue every five, each a whole sentence. */
function transcript(seconds: number, sentence = (n: number) => `This is line ${n}.`): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (let at = 0; at < seconds; at += 5) {
    cues.push({ startSeconds: at, endSeconds: at + 5, text: sentence(at / 5) });
  }
  return cues;
}

describe('segmentsFromCues', () => {
  it('cuts a twenty-minute lecture into overlapping spans', () => {
    const segments = segmentsFromCues(transcript(1200));

    expect(segments.map((segment) => segment.tStartSeconds)).toEqual([0, 240, 480, 720, 960]);
    expect(segments.map((segment) => segment.tEndSeconds)).toEqual([270, 510, 750, 990, 1200]);
    expect(segments.map((segment) => segment.ordinal)).toEqual([0, 1, 2, 3, 4]);
  });

  it('overlaps each span with the one before it by about thirty seconds', () => {
    const segments = segmentsFromCues(transcript(1200));

    for (let i = 1; i < segments.length; i += 1) {
      const previousEnd = segments[i - 1].tEndSeconds ?? 0;
      expect(previousEnd - (segments[i].tStartSeconds ?? 0)).toBe(30);
    }
  });

  it('stores a timed span and never an anchored one', () => {
    for (const segment of segmentsFromCues(transcript(1200))) {
      // catalogue_segments_one_address_ck: timed or anchored, never both.
      expect(segment.sectionAnchor).toBeNull();
      expect(segment.tStartSeconds).not.toBeNull();
    }
  });

  it('cuts where a sentence ends rather than where the clock says', () => {
    // A sentence every minute instead of every five seconds, so the target
    // length and the nearest sentence end are in different places.
    const cues = transcript(1200, (n) => ((n + 1) % 12 === 0 ? `Line ${n}.` : `line ${n}`));
    const [first] = segmentsFromCues(cues);

    expect(first.tEndSeconds).toBe(240);
    expect(first.text.endsWith('.')).toBe(true);
  });

  it('cuts anyway when a transcript has no punctuation at all', () => {
    const cues = transcript(1200, (n) => `word ${n}`);
    const segments = segmentsFromCues(cues);

    expect(segments[0].tEndSeconds).toBe(360);
    for (const segment of segments) {
      expect((segment.tEndSeconds ?? 0) - (segment.tStartSeconds ?? 0)).toBeLessThanOrEqual(360);
    }
  });

  it('leaves a short lecture in one piece', () => {
    const segments = segmentsFromCues(transcript(120));

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ tStartSeconds: 0, tEndSeconds: 120 });
  });

  it('absorbs a tail too short to be worth its own span', () => {
    const segments = segmentsFromCues(transcript(1200));
    const last = segments[segments.length - 1];

    // 960 to 1200 rather than a 240-second span followed by a 40-second one.
    expect((last.tEndSeconds ?? 0) - (last.tStartSeconds ?? 0)).toBe(240);
  });

  it('is open-ended when the transcript does not say where the last line stops', () => {
    const segments = segmentsFromCues([{ startSeconds: 0, endSeconds: null, text: 'All of it.' }]);

    // Which catalogue_segments allows, and reads as "to the end of the work".
    expect(segments).toEqual([
      {
        ordinal: 0,
        tStartSeconds: 0,
        tEndSeconds: null,
        sectionAnchor: null,
        heading: null,
        text: 'All of it.',
      },
    ]);
  });

  it('has nothing to cut when the transcript is empty', () => {
    expect(segmentsFromCues([])).toEqual([]);
    expect(segmentsFromCues([{ startSeconds: 0, endSeconds: 5, text: '   ' }])).toEqual([]);
  });
});

describe('segmentsFromChapters', () => {
  const chapters = [
    { startSeconds: 0, title: 'The geometry of linear equations' },
    { startSeconds: 225, title: 'Row picture' },
    { startSeconds: 750, title: 'Column picture' },
  ];

  it('runs each chapter up to the next one, and the last to the end', () => {
    const segments = segmentsFromChapters(chapters, { title: 'Lecture 1', durationSeconds: 2389 });

    expect(segments.map((segment) => [segment.tStartSeconds, segment.tEndSeconds])).toEqual([
      [0, 225],
      [225, 750],
      [750, 2389],
    ]);
  });

  it('gives the chapter title the lecture it belongs to, because that is what is embedded', () => {
    const [, second] = segmentsFromChapters(chapters, {
      title: 'Lecture 1: The Geometry of Linear Equations',
      durationSeconds: 2389,
    });

    expect(second.heading).toBe('Row picture');
    expect(second.text).toBe('Lecture 1: The Geometry of Linear Equations. Row picture');
  });

  it('leaves the last chapter open-ended when the video has no duration', () => {
    const segments = segmentsFromChapters(chapters, { title: 'Lecture 1', durationSeconds: null });
    expect(segments[segments.length - 1].tEndSeconds).toBeNull();
  });
});

describe('what a cut segment becomes when it is queued', () => {
  /**
   * The other half of the acceptance, and the reason the cut stores offsets
   * rather than hiding `?t=` in a URL: lib/learn/catalogue/queue.ts reads a
   * timed segment as a `timestamp` locator and opens the video at the minute.
   * Asserted here because the two were written a step apart and nothing else
   * holds them together.
   */
  const item = {
    id: 'item-1',
    title: 'Lecture 1',
    author: null,
    kind: 'video',
    canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
    durationSeconds: 2389,
    publishedAt: '2009-05-06',
  };

  it('opens a timed span at its own minute', () => {
    const [, second] = segmentsFromCues(transcript(1200));
    const locator = locatorFor({
      segmentId: 'segment-1',
      ordinal: second.ordinal,
      heading: second.heading,
      sectionAnchor: second.sectionAnchor,
      tStartSeconds: second.tStartSeconds,
      tEndSeconds: second.tEndSeconds,
      item,
    });

    expect(locator.locatorKind).toBe('timestamp');
    expect(locator.locatorLabel).toBe('4:00–8:30');
    expect(locator.openUrl).toBe('https://www.youtube.com/watch?v=abc123&t=240');
  });

  it('opens a whole-video segment at the start, because nothing knows better', () => {
    const segment = wholeVideoSegment({ title: 'Lecture 2', description: '' });
    const locator = locatorFor({
      segmentId: 'segment-2',
      ordinal: segment.ordinal,
      heading: segment.heading,
      sectionAnchor: segment.sectionAnchor,
      tStartSeconds: segment.tStartSeconds,
      tEndSeconds: segment.tEndSeconds,
      item,
    });

    expect(locator.locatorKind).toBe('whole');
    expect(locator.openUrl).toBe('https://www.youtube.com/watch?v=abc123');
  });
});

describe('a video with nothing to go on', () => {
  it('is one segment for the whole thing, carrying what is known about it', () => {
    const segment = wholeVideoSegment({
      title: 'Lecture 5: Transposes',
      description: 'MIT 18.06 Linear Algebra, Spring 2010.',
    });

    expect(segment).toEqual({
      ordinal: 0,
      tStartSeconds: null,
      tEndSeconds: null,
      sectionAnchor: null,
      heading: null,
      text: 'Lecture 5: Transposes\n\nMIT 18.06 Linear Algebra, Spring 2010.',
    });
  });
});

describe('segmentsForVideo', () => {
  const video = {
    title: 'Lecture 1',
    description: 'MIT 18.06.',
    durationSeconds: 1200,
    chapters: [
      { startSeconds: 0, title: 'One' },
      { startSeconds: 300, title: 'Two' },
      { startSeconds: 600, title: 'Three' },
    ],
  };

  it('prefers the transcript, which is the only text of what was said', () => {
    const cut = segmentsForVideo(video, transcript(1200));
    expect(cut.cutBy).toBe('transcript');
    expect(cut.segments.length).toBeGreaterThan(3);
  });

  it('falls back to the chapter markers when no transcript could be reached', () => {
    const cut = segmentsForVideo(video, null);
    expect(cut.cutBy).toBe('chapters');
    expect(cut.segments).toHaveLength(3);
  });

  it('falls back to one whole-video segment when there is neither', () => {
    const cut = segmentsForVideo({ ...video, chapters: [] }, null);
    expect(cut.cutBy).toBe('whole');
    expect(cut.segments).toHaveLength(1);
    expect(cut.segments[0].tStartSeconds).toBeNull();
  });
});
