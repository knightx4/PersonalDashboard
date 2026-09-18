import { describe, expect, it } from 'vitest';
import { mentionsDash, questionFrom, splitOnMention } from './mention';

describe('mentionsDash', () => {
  it('finds the tag anywhere in the comment', () => {
    expect(mentionsDash('@dash what does option B cost?')).toBe(true);
    expect(mentionsDash('I think A, but @dash what breaks?')).toBe(true);
    expect(mentionsDash('what breaks here @dash')).toBe(true);
  });

  it('ignores case', () => {
    expect(mentionsDash('@Dash is this still true?')).toBe(true);
    expect(mentionsDash('@DASH is this still true?')).toBe(true);
  });

  it('is not a note to yourself', () => {
    expect(mentionsDash('Come back to this when the queue is empty.')).toBe(false);
    expect(mentionsDash('')).toBe(false);
  });

  it('does not fire on a longer word or an address', () => {
    expect(mentionsDash('the @dashboard is slow')).toBe(false);
    expect(mentionsDash('mail me@dash.io about it')).toBe(false);
    expect(mentionsDash('ask me@dash')).toBe(false);
    expect(mentionsDash('@dash.io is the domain')).toBe(false);
  });
});

describe('questionFrom', () => {
  it('takes the tag out and leaves the question', () => {
    expect(questionFrom('@dash what does option B cost?')).toBe('what does option B cost?');
    expect(questionFrom('I think A, but @dash what breaks?')).toBe('I think A, but what breaks?');
  });

  it('keeps the body when the tag is all there was', () => {
    expect(questionFrom('@dash')).toBe('@dash');
  });
});

describe('splitOnMention', () => {
  it('separates the tag from the words around it', () => {
    expect(splitOnMention('I think A, but @dash what breaks?')).toEqual([
      { text: 'I think A, but ', mention: false },
      { text: '@dash', mention: true },
      { text: ' what breaks?', mention: false },
    ]);
  });

  it('finds every one of them', () => {
    expect(splitOnMention('@dash and again @DASH').filter((part) => part.mention)).toEqual([
      { text: '@dash', mention: true },
      { text: '@DASH', mention: true },
    ]);
  });

  it('leaves a body with no tag as one part', () => {
    expect(splitOnMention('the @dashboard is slow')).toEqual([
      { text: 'the @dashboard is slow', mention: false },
    ]);
    expect(splitOnMention('')).toEqual([{ text: '', mention: false }]);
  });
});
