import { describe, expect, it } from 'vitest';
import { CONFIDENCE } from '@/lib/learn/confidence';
import {
  earnsHint,
  givesAnswerAway,
  HINT_MAX,
  hintedLine,
  holdsRung,
  missKindOf,
  readFirstTry,
  readHint,
  readHintsUsed,
  readMissKind,
  retryLines,
  rowHint,
  wantsHint,
  withHintRule,
} from './hint';

describe('one hint before the answer (plan #2522.7)', () => {
  it('gives a hint on a first miss with a usable hint, and only then', () => {
    expect(earnsHint({ correct: false, hintsUsed: 0, hint: 'Look at who pays.' })).toBe(true);
    expect(earnsHint({ correct: true, hintsUsed: 0, hint: 'Look at who pays.' })).toBe(false);
    expect(earnsHint({ correct: false, hintsUsed: 1, hint: 'Look at who pays.' })).toBe(false);
    expect(earnsHint({ correct: false, hintsUsed: 0, hint: null })).toBe(false);
    expect(wantsHint(0)).toBe(true);
    expect(wantsHint(null)).toBe(true);
    expect(wantsHint(1)).toBe(false);
  });

  it('throws away a hint that repeats the expected answer', () => {
    expect(givesAnswerAway('Think: the price falls.', 'The price falls')).toBe(true);
    expect(givesAnswerAway('Which way does the price move?', 'The price falls')).toBe(false);
    expect(readHint('  Reread the second sentence of the case.  ', 'The price falls')).toBe(
      'Reread the second sentence of the case.',
    );
    expect(readHint('The answer is: the price falls.', 'the price falls')).toBeNull();
    expect(readHint('', 'x')).toBeNull();
    expect(readHint(42, 'x')).toBeNull();
    expect(readHint('a'.repeat(HINT_MAX + 50), null)?.length).toBe(HINT_MAX);
  });

  it('keeps a right answer after a hint, or at Guessing, at its rung', () => {
    expect(holdsRung({ correct: true, confidence: null, hintsUsed: 1 })).toBe(true);
    expect(holdsRung({ correct: true, confidence: CONFIDENCE.guessing, hintsUsed: 0 })).toBe(true);
    expect(holdsRung({ correct: true, confidence: CONFIDENCE.certain, hintsUsed: 0 })).toBe(false);
    // A miss is a miss, hint or not.
    expect(holdsRung({ correct: false, confidence: null, hintsUsed: 1 })).toBe(false);
  });

  it('names a sure miss a misconception whatever the grader called it', () => {
    expect(missKindOf({ correct: false, confidence: CONFIDENCE.certain, graderKind: 'slip' })).toBe('misconception');
    expect(missKindOf({ correct: false, confidence: CONFIDENCE.unsure, graderKind: 'slip' })).toBe('slip');
    expect(missKindOf({ correct: false, confidence: null, graderKind: null })).toBeNull();
    expect(missKindOf({ correct: true, confidence: CONFIDENCE.certain, graderKind: 'slip' })).toBeNull();
    expect(readMissKind('wrong_idea')).toBe('wrong_idea');
    expect(readMissKind('typo')).toBeNull();
  });

  it('reads the first try off a row, and nothing malformed', () => {
    const first = { response: 'It rises.', why: 'Wrong way.', hint: 'Who has more to sell?', kind: 'wrong_idea' };
    expect(readFirstTry(first)).toEqual(first);
    expect(readFirstTry({ ...first, revealed: true })?.revealed).toBe(true);
    expect(readFirstTry({ ...first, hint: '' })).toBeNull();
    expect(readFirstTry({ ...first, kind: 'nonsense' })?.kind).toBeNull();
    expect(readFirstTry(null)).toBeNull();
    expect(readFirstTry([first])).toBeNull();
    expect(readHintsUsed('1')).toBe(1);
    expect(readHintsUsed(null)).toBe(0);
  });

  it('shows the hint while the question is open, and says what it came to after', () => {
    const first = { response: 'It rises.', why: null, hint: 'Who has more to sell?', kind: null };
    expect(rowHint({ hints_used: 1, first_try: first }, false)).toEqual({
      hint: { hint: 'Who has more to sell?', response: 'It rises.' },
      hintsUsed: 1,
      revealed: false,
    });
    expect(rowHint({ hints_used: 1, first_try: { ...first, revealed: true } }, true)).toEqual({
      hint: null,
      hintsUsed: 1,
      revealed: true,
    });
    expect(hintedLine({ correct: true, hintsUsed: 1 })).toMatch(/^After a hint, so it counts/);
    expect(hintedLine({ correct: false, hintsUsed: 1, revealed: true })).toMatch(/asked for the answer/);
    expect(hintedLine({ correct: false, hintsUsed: 0 })).toBeNull();
    expect(hintedLine({ correct: null, hintsUsed: 1 })).toBeNull();
  });

  it('tells the grader about the first try on a retry, and asks for a hint without the answer', () => {
    expect(retryLines(null)).toEqual([]);
    const lines = retryLines({ response: 'It rises.', why: null, hint: 'Who has more to sell?', kind: null });
    expect(lines.join('\n')).toContain('It rises.');
    expect(lines.join('\n')).toContain('Who has more to sell?');
    expect(withHintRule('SYSTEM')).toMatch(/^SYSTEM\n\nWHEN THE ANSWER IS WRONG/);
    expect(withHintRule('SYSTEM')).toContain('Never state the expected answer');
  });
});
