import { describe, expect, it } from 'vitest';
import { ASKS_FOR_CHANGE, answerAccepts } from './answer-accepts';

describe('answerAccepts', () => {
  it('reads the answers the person gives a stop as accepts', () => {
    const yes = [
      'accept',
      'Accepted',
      'yes',
      'ok',
      'Okay.',
      'sure',
      'fine',
      "it's fine",
      "It's probably fine",
      'probably fine',
      'looks good',
      'Looks good!',
      'good',
      'go ahead',
      'Ship it.',
      "I'll let you know if something comes up",
      'yes its fine',
      'Accept.',
    ];
    for (const answer of yes) expect([answer, answerAccepts(answer)]).toEqual([answer, true]);
  });

  it('reads curly apostrophes, case and punctuation the same as plain ones', () => {
    expect(answerAccepts('It’s fine')).toBe(true);
    expect(answerAccepts('IT’S PROBABLY FINE!!')).toBe(true);
    expect(answerAccepts('I’ll let you know if something comes up.')).toBe(true);
    expect(answerAccepts('  "ok"  ')).toBe(true);
  });

  it('refuses an answer that asks for a change', () => {
    const no = [
      'Make the button bigger',
      'move the header up',
      'fine but fix the spacing',
      'yes, but smaller',
      'remove the second card',
      'add a label',
      'it should be blue',
      'use a list instead',
      'change the colour',
      'not fine',
      'no',
      "don't ship it",
    ];
    for (const answer of no) expect([answer, answerAccepts(answer)]).toEqual([answer, false]);
  });

  it('refuses a question back', () => {
    expect(answerAccepts('is it fine?')).toBe(false);
    expect(answerAccepts('ok?')).toBe(false);
  });

  it('refuses an answer long enough to be instructions', () => {
    expect(
      answerAccepts('yes it is fine it is fine it is fine it is fine it is fine it is fine'),
    ).toBe(false);
  });

  it('refuses words it does not know, and an answer with no yes in it', () => {
    expect(answerAccepts('ok go ahead. I dont need the critic on those 121')).toBe(false);
    expect(answerAccepts('it is')).toBe(false);
    expect(answerAccepts('')).toBe(false);
    expect(answerAccepts('   ')).toBe(false);
    expect(answerAccepts(null)).toBe(false);
  });

  it('refuses every word on the change list, even beside a yes', () => {
    for (const word of ASKS_FOR_CHANGE) expect([word, answerAccepts(`ok ${word}`)]).toEqual([word, false]);
  });
});
