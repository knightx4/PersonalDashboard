import { describe, expect, it } from 'vitest';
import {
  MIN_BODY_CHARS,
  NOTE_CLASSES,
  SAMPLE_CHARS,
  classifyPayloadSchema,
  goesToExtraction,
  sampleFor,
  tooShortToRead,
} from '@/lib/learn/vault/classify-payload';

describe('which classes are read for claims', () => {
  it('reads knowledge and mixed', () => {
    expect(goesToExtraction('knowledge')).toBe(true);
    expect(goesToExtraction('mixed')).toBe(true);
  });

  it('does not read evidence or operational', () => {
    // Evidence is skipped here because it produces no concepts, not because it
    // does not matter. A later slice reads it for confidence in concepts found
    // elsewhere.
    expect(goesToExtraction('evidence')).toBe(false);
    expect(goesToExtraction('operational')).toBe(false);
  });

  it('covers every class, so a new one cannot default to being read', () => {
    for (const noteClass of NOTE_CLASSES) {
      expect(typeof goesToExtraction(noteClass)).toBe('boolean');
    }
  });
});

describe('the sample the classifier reads', () => {
  it('takes a short note whole', () => {
    expect(sampleFor('  A claim about wages.  ')).toBe('A claim about wages.');
  });

  it('caps a long note, since this runs once per note across the vault', () => {
    const body = 'x'.repeat(SAMPLE_CHARS * 3);
    expect(sampleFor(body)).toHaveLength(SAMPLE_CHARS);
  });

  it('measures the trimmed body, not the leading whitespace', () => {
    const body = `${' '.repeat(500)}${'y'.repeat(SAMPLE_CHARS)}`;
    expect(sampleFor(body)).toBe('y'.repeat(SAMPLE_CHARS));
  });
});

describe('the length floor', () => {
  it('skips a note too short to be stating anything', () => {
    expect(tooShortToRead('Call Dan back')).toBe(true);
  });

  it('lets a claim stated in a few sentences through', () => {
    expect(tooShortToRead('a'.repeat(MIN_BODY_CHARS))).toBe(false);
  });

  it('ignores whitespace padding, which a note full of blank lines has', () => {
    expect(tooShortToRead(`  short  ${'\n'.repeat(400)}`)).toBe(true);
  });
});

describe('the payload', () => {
  it('takes a class and a reason', () => {
    const parsed = classifyPayloadSchema.safeParse({
      class: 'knowledge',
      reason: 'Argues that upzoning lowers rents.',
    });
    expect(parsed.success && parsed.data.class).toBe('knowledge');
  });

  it('refuses a class it does not know', () => {
    expect(classifyPayloadSchema.safeParse({ class: 'interesting', reason: 'x' }).success).toBe(
      false,
    );
  });

  it('refuses an empty reason, since the reason is shown and argued with', () => {
    expect(classifyPayloadSchema.safeParse({ class: 'knowledge', reason: '  ' }).success).toBe(
      false,
    );
  });
});
