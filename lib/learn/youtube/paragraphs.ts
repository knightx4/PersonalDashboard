import type { TranscriptCue } from '@/lib/learn/catalogue/segment';

/**
 * A transcript as paragraphs of about a minute, each with its start time.
 *
 * Caption lines are a few words each, cut where the caption wrapped on
 * screen. Read one per line they are unreadable, so they are joined, and a
 * paragraph is closed at the first sentence end after `targetSeconds`, or at
 * twice that if the speaker never ends one.
 */
export type Paragraph = { startSeconds: number; text: string };

export function paragraphsFromCues(cues: TranscriptCue[], targetSeconds = 60): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let start: number | null = null;
  let words: string[] = [];

  for (const cue of cues) {
    if (start === null) start = cue.startSeconds;
    words.push(cue.text);
    const elapsed = cue.startSeconds - start;
    const sentenceEnd = /[.!?]["'”’)]?$/.test(cue.text);
    if ((elapsed >= targetSeconds && sentenceEnd) || elapsed >= targetSeconds * 2) {
      paragraphs.push({ startSeconds: start, text: words.join(' ') });
      start = null;
      words = [];
    }
  }
  if (start !== null && words.length > 0) paragraphs.push({ startSeconds: start, text: words.join(' ') });
  return paragraphs;
}
