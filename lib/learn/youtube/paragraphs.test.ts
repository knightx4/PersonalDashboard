import { describe, expect, it } from 'vitest';
import { paragraphsFromCues } from '@/lib/learn/youtube/paragraphs';

const cue = (startSeconds: number, text: string) => ({ startSeconds, endSeconds: null, text });

describe('paragraphsFromCues', () => {
  it('closes a paragraph at the first sentence end past the target', () => {
    const paragraphs = paragraphsFromCues(
      [cue(0, 'So let us'), cue(30, 'start here.'), cue(61, 'The row picture'), cue(70, 'comes first.'), cue(80, 'Then columns')],
      60,
    );
    expect(paragraphs).toEqual([
      { startSeconds: 0, text: 'So let us start here. The row picture comes first.' },
      { startSeconds: 80, text: 'Then columns' },
    ]);
  });

  it('cuts anyway when nobody ends a sentence', () => {
    const paragraphs = paragraphsFromCues([cue(0, 'and'), cue(60, 'so'), cue(120, 'on'), cue(130, 'more')], 60);
    expect(paragraphs.map((p) => p.startSeconds)).toEqual([0, 130]);
  });

  it('is empty for no cues', () => {
    expect(paragraphsFromCues([])).toEqual([]);
  });
});
