import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE,
  REASONING_MAX,
  REASONING_RULE,
  cleanSignals,
  confidenceWords,
  isGuess,
  isMisconceptionCandidate,
  missKindFor,
  readAnswerSignals,
  readConfidence,
  signalColumns,
  signalLines,
  withReasoningRule,
} from './confidence';

/**
 * How sure you were and how you reasoned (plan #2522.3). The rules are small,
 * and each one decides what an answer does to an idea, so each is pinned here.
 */

describe('reading the signals', () => {
  it('takes a confidence from 0 to 1, from a number or a form string', () => {
    expect(readConfidence(0.75)).toBe(0.75);
    expect(readConfidence('0.25')).toBe(0.25);
    expect(readConfidence('')).toBeNull();
    expect(readConfidence(null)).toBeNull();
    expect(readConfidence(1.5)).toBeNull();
    expect(readConfidence('sure')).toBeNull();
  });

  it('trims reasoning, drops it when empty and cuts it to the cap', () => {
    expect(cleanSignals({ reasoning: '  because  ' }).reasoning).toBe('because');
    expect(cleanSignals({ reasoning: '   ' }).reasoning).toBeNull();
    expect(cleanSignals({ reasoning: 'x'.repeat(REASONING_MAX + 10) }).reasoning).toHaveLength(REASONING_MAX);
    expect(cleanSignals(undefined)).toEqual({ confidence: null, reasoning: null });
  });

  it('reads both off a form, and nulls from a form that does not ask', () => {
    const form = new FormData();
    form.set('confidence', '0.95');
    form.set('reasoning', 'The rate is fixed ahead.');
    expect(readAnswerSignals(form)).toEqual({ confidence: 0.95, reasoning: 'The rate is fixed ahead.' });
    expect(readAnswerSignals(new FormData())).toEqual({ confidence: null, reasoning: null });
  });
});

describe('a guess', () => {
  it('is Guessing and nothing above it; no confidence is not a guess', () => {
    expect(isGuess(CONFIDENCE.guessing)).toBe(true);
    expect(isGuess(0.1)).toBe(true);
    expect(isGuess(CONFIDENCE.unsure)).toBe(false);
    expect(isGuess(null)).toBe(false);
    expect(isGuess(undefined)).toBe(false);
  });
});

describe('a misconception candidate', () => {
  it('is a wrong answer at Fairly sure or Certain', () => {
    expect(isMisconceptionCandidate({ correct: false, confidence: CONFIDENCE.fairlySure })).toBe(true);
    expect(isMisconceptionCandidate({ correct: false, confidence: CONFIDENCE.certain })).toBe(true);
  });

  it('is never a right answer, an unsure miss or a miss with no confidence', () => {
    expect(isMisconceptionCandidate({ correct: true, confidence: CONFIDENCE.certain })).toBe(false);
    expect(isMisconceptionCandidate({ correct: false, confidence: CONFIDENCE.unsure })).toBe(false);
    expect(isMisconceptionCandidate({ correct: false, confidence: null })).toBe(false);
  });

  it('is written to miss_kind as misconception, and nothing else is judged', () => {
    expect(missKindFor({ correct: false, confidence: 0.95 })).toBe('misconception');
    expect(missKindFor({ correct: false, confidence: 0.25 })).toBeNull();
    expect(missKindFor({ correct: true, confidence: 0.95 })).toBeNull();
  });
});

describe('the columns an answer writes', () => {
  it('writes only what was given', () => {
    expect(signalColumns({ confidence: null, reasoning: null }, true)).toEqual({});
    expect(signalColumns({ confidence: 0.5, reasoning: 'why' }, true)).toEqual({ confidence: 0.5, reasoning: 'why' });
  });

  it('adds the miss kind on a confident miss', () => {
    expect(signalColumns({ confidence: 0.75, reasoning: null }, false)).toEqual({
      confidence: 0.75,
      miss_kind: 'misconception',
    });
  });
});

describe('what the grader is told', () => {
  it('names each step in the page’s words', () => {
    expect(confidenceWords(CONFIDENCE.guessing)).toBe('Guessing');
    expect(confidenceWords(CONFIDENCE.unsure)).toBe('Unsure');
    expect(confidenceWords(CONFIDENCE.fairlySure)).toBe('Fairly sure');
    expect(confidenceWords(CONFIDENCE.certain)).toBe('Certain');
  });

  it('adds nothing when nothing was given', () => {
    expect(signalLines(null)).toEqual([]);
    expect(signalLines({})).toEqual([]);
  });

  it('carries the reasoning, and the confidence as context only', () => {
    const lines = signalLines({ confidence: 0.95, reasoning: 'Pay is set a year ahead.' }).join('\n');
    expect(lines).toContain('Certain');
    expect(lines).toContain('does not change the grade');
    expect(lines).toContain('Pay is set a year ahead.');
  });

  it('puts the reasoning rule after the grader’s own prompt', () => {
    expect(withReasoningRule('Mark it.')).toBe(`Mark it.\n\n${REASONING_RULE}`);
    expect(REASONING_RULE).toContain('contradicts the answer');
  });
});
