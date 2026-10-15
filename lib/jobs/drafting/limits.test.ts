import { describe, expect, it } from 'vitest';
import {
  answerLimit,
  countCharacters,
  countWords,
  describeLimit,
  describeOverrun,
  limitFromQuestion,
  overLimit,
} from './limits';

describe('limitFromQuestion', () => {
  it.each([
    ['Why do you want to work here? (140 characters)', 140, 'characters'],
    ['Tell us about a hard problem. 200 words max', 200, 'words'],
    ['Describe your best project (max 1,000 characters)', 1000, 'characters'],
    ['What drew you to us? Please keep it to 150 words.', 150, 'words'],
    ['In 150 to 200 words, tell us why', 200, 'words'],
    ['Cover note, 250 word limit', 250, 'words'],
    ['Anything else? (up to 500 chars)', 500, 'characters'],
    ['Summarise your experience in 100 words or less', 100, 'words'],
    ['Answer in no more than 300 words.', 300, 'words'],
    ['Why this team (2000-character limit)?', 2000, 'characters'],
  ])('reads %j', (text, count, unit) => {
    expect(limitFromQuestion(text)).toEqual({ count, unit, from: 'question' });
  });

  it.each([
    'Describe yourself in 3 words',
    'Write at least 100 words about your background',
    'What is your notice period?',
    'Tell us about a 10 word sentence you wrote and are proud of',
  ])('sets no limit on %j', (text) => {
    expect(limitFromQuestion(text)).toBeNull();
  });
});

describe('answerLimit', () => {
  it('takes the row word_limit before the question wording', () => {
    expect(answerLimit(120, 'Why us? (140 characters)')).toEqual({ count: 120, unit: 'words', from: 'set' });
  });

  it('falls back to the question when the row has none', () => {
    expect(answerLimit(null, 'Why us? (140 characters)')).toEqual({
      count: 140,
      unit: 'characters',
      from: 'question',
    });
    expect(answerLimit(0, 'Why us?')).toBeNull();
  });

  it('describes a limit for a prompt', () => {
    expect(describeLimit({ count: 1000, unit: 'characters', from: 'question' })).toBe('1,000 characters');
  });
});

describe('measuring an answer', () => {
  it('counts words as runs of non-space', () => {
    expect(countWords('  I rebuilt   the close.\nTwice. ')).toBe(5);
    expect(countWords('   ')).toBe(0);
  });

  it('counts characters with spaces, by code point', () => {
    expect(countCharacters('Café ok')).toBe(7);
    expect(countCharacters('  👍 ')).toBe(1);
  });

  it('flags only what runs past the limit', () => {
    const words = { count: 3, unit: 'words' as const, from: 'set' as const };
    expect(overLimit('one two three', words)).toBeNull();
    expect(overLimit('one two three four', words)).toEqual({ count: 4, limit: 3, unit: 'words' });
    const chars = { count: 10, unit: 'characters' as const, from: 'question' as const };
    expect(overLimit('ten chars!', chars)).toBeNull();
    expect(overLimit('eleven char', chars)).toEqual({ count: 11, limit: 10, unit: 'characters' });
    expect(overLimit('anything at all', null)).toBeNull();
  });

  it('says how far over an answer is', () => {
    expect(describeOverrun({ count: 163, limit: 150, unit: 'words' })).toBe('163 words, over the 150-word limit');
    expect(describeOverrun({ count: 1200, limit: 1000, unit: 'characters' })).toBe(
      '1,200 characters, over the 1,000-character limit',
    );
  });
});
