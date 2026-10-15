import { describe, expect, it } from 'vitest';
import { answerLimit, describeLimit, limitFromQuestion } from './limits';

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
