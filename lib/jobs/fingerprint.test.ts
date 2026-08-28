import { describe, expect, it } from 'vitest';
import {
  guessQuestionKind,
  looksLikeQuestion,
  normalizeQuestion,
  questionFingerprint,
  splitQuestionBlock,
} from '@/lib/jobs/fingerprint';

describe('normalizeQuestion', () => {
  it('collapses the same question wearing different clothes', () => {
    const a = normalizeQuestion('Why do you want to work here?');
    const b = normalizeQuestion(
      'Please briefly describe, in your own words, why you want to work here. (200 words or less)',
    );
    expect(a).toBe('why want work here');
    expect(b).toBe('why want work here');
  });

  it('gives the same fingerprint to both', () => {
    expect(questionFingerprint('Why do you want to work here?')).toBe(
      questionFingerprint('  WHY do you want to work here?!  '),
    );
  });

  it('does not collapse genuinely different questions', () => {
    expect(questionFingerprint('Why do you want to work here?')).not.toBe(
      questionFingerprint('What draws you to our mission?'),
    );
  });

  it('keeps a company-specific question distinct from the generic one', () => {
    // The near-miss that embedding similarity is for; exact matching must not
    // silently answer the Ramp question with the generic canonical answer.
    expect(questionFingerprint('Why do you want to work at Ramp?')).not.toBe(
      questionFingerprint('Why do you want to work here?'),
    );
  });
});

describe('splitQuestionBlock', () => {
  it('splits a numbered list', () => {
    expect(
      splitQuestionBlock(`1. Why this role?
2. Tell us about a time you shipped something hard.
3. What is your notice period?`),
    ).toEqual([
      'Why this role?',
      'Tell us about a time you shipped something hard.',
      'What is your notice period?',
    ]);
  });

  it('keeps a wrapped question in a numbered list together', () => {
    expect(
      splitQuestionBlock(`1. Why this role, and what about the team
   makes it interesting to you?
2. Notice period?`),
    ).toEqual([
      'Why this role, and what about the team makes it interesting to you?',
      'Notice period?',
    ]);
  });

  it('splits a bulleted list', () => {
    expect(splitQuestionBlock('- One question here?\n- Another question here?')).toEqual([
      'One question here?',
      'Another question here?',
    ]);
  });

  it('splits blank-line-separated prose into whole questions', () => {
    expect(
      splitQuestionBlock('Describe a project\nyou are proud of.\n\nWhy us?'),
    ).toEqual(['Describe a project you are proud of.', 'Why us?']);
  });

  it('returns nothing for an empty paste', () => {
    expect(splitQuestionBlock('   \n  ')).toEqual([]);
  });
});

describe('looksLikeQuestion', () => {
  it('rejects the fields every form has', () => {
    for (const field of [
      'First name',
      'Email',
      'Phone',
      'Resume/CV',
      'LinkedIn Profile',
      'Are you Hispanic or Latino?',
      'Veteran status',
      'How did you hear about us?',
    ]) {
      expect(looksLikeQuestion(field), field).toBe(false);
    }
  });

  it('keeps the questions worth answering', () => {
    for (const question of [
      'Why do you want to work at Ramp?',
      'Describe a time you influenced a decision without authority.',
      'What is your expected compensation?',
    ]) {
      expect(looksLikeQuestion(question), question).toBe(true);
    }
  });
});

describe('guessQuestionKind', () => {
  it('sorts a captured form instead of filing everything as other', () => {
    expect(guessQuestionKind('Why do you want to work here?')).toBe('motivation');
    expect(guessQuestionKind('Tell me about a time you missed a deadline.')).toBe('behavioral');
    expect(guessQuestionKind('Will you now or in the future require visa sponsorship?')).toBe(
      'logistics',
    );
    expect(guessQuestionKind('What is your experience with SQL?')).toBe('technical');
    expect(guessQuestionKind('Please self-identify your gender.')).toBe('demographic');
  });
});
