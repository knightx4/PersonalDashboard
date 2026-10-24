import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CEILING,
  evidenceStrength,
  isMisconception,
  isUntested,
  halvesOn,
  spillOver,
  strength,
  strengthWithEvidence,
  type StrengthInput,
  stateAfterAnswer,
} from './strength';

const T0 = '2026-01-01T00:00:00Z';
const day = (n: number) => new Date(Date.parse(T0) + n * 86_400_000);

const tested = (state: StrengthInput['state'], extra: Partial<StrengthInput> = {}): StrengthInput => ({
  state,
  established: 'tested',
  tested_at: T0,
  declared_at: null,
  review_interval_days: null,
  ...extra,
});

describe('strength', () => {
  it('weights each level on the day it is tested', () => {
    expect(strength(tested('shaky'), day(0))).toBeCloseTo(0.35);
    expect(strength(tested('recognised'), day(0))).toBeCloseTo(0.55);
    expect(strength(tested('known'), day(0))).toBeCloseTo(0.8);
    expect(strength(tested('sharp'), day(0))).toBeCloseTo(1);
    expect(strength(tested('unknown'), day(0))).toBe(0);
  });

  it('weights each kind of evidence', () => {
    const sharp = { state: 'sharp', review_interval_days: null } as const;
    expect(strength({ ...sharp, established: 'tested', tested_at: T0, declared_at: null }, day(0))).toBeCloseTo(1);
    expect(strength({ ...sharp, established: 'declared', tested_at: null, declared_at: T0 }, day(0))).toBeCloseTo(0.75);
    expect(strength({ ...sharp, established: 'inferred', tested_at: null, declared_at: null }, day(0))).toBeCloseTo(0.5);
  });

  it('halves a tested idea every 30 days and a declared one every 45', () => {
    expect(strength(tested('sharp'), day(30))).toBeCloseTo(0.5);
    expect(strength(tested('sharp'), day(60))).toBeCloseTo(0.25);
    const declared: StrengthInput = {
      state: 'sharp',
      established: 'declared',
      tested_at: null,
      declared_at: T0,
      review_interval_days: null,
    };
    expect(strength(declared, day(45))).toBeCloseTo(0.375);
  });

  it('does not fade an idea with no date, and does not rise before the date', () => {
    const inferred: StrengthInput = {
      state: 'known',
      established: 'inferred',
      tested_at: null,
      declared_at: null,
      review_interval_days: null,
    };
    expect(strength(inferred, day(400))).toBeCloseTo(0.4);
    expect(strength(tested('sharp'), day(-10))).toBeCloseTo(1);
  });

  it('fades a reviewed idea more slowly than an unreviewed one', () => {
    const reviewed = tested('known', { review_interval_days: 35 });
    expect(strength(reviewed, day(52.5))).toBeCloseTo(0.4);
    expect(strength(reviewed, day(60))).toBeGreaterThan(strength(tested('known'), day(60)));
  });

  it('scores a misconception 0 and flags it', () => {
    expect(strength(tested('misconception'), day(0))).toBe(0);
    expect(isMisconception(tested('misconception'))).toBe(true);
    expect(isMisconception(tested('shaky'))).toBe(false);
  });

  it('says when the next halving falls', () => {
    expect(halvesOn(tested('known'), day(10))?.getTime()).toBe(day(30).getTime());
    expect(halvesOn(tested('known'), day(30))?.getTime()).toBe(day(60).getTime());
    expect(halvesOn(tested('unknown'), day(0))).toBeNull();
  });
});

describe('spillOver', () => {
  it('sums strength times similarity squared', () => {
    expect(
      spillOver([
        { strength: 0.8, similarity: 0.5 },
        { strength: 0.4, similarity: 0.5 },
      ]),
    ).toBeCloseTo(0.3);
  });

  it('caps at 1 and is 0 with no neighbours', () => {
    expect(spillOver(Array.from({ length: 6 }, () => ({ strength: 1, similarity: 0.9 })))).toBe(1);
    expect(spillOver([])).toBe(0);
  });

  it('counts only the six most similar', () => {
    const six = Array.from({ length: 6 }, () => ({ strength: 0.1, similarity: 0.5 }));
    expect(spillOver([...six, { strength: 1, similarity: 0.1 }])).toBeCloseTo(spillOver(six));
  });
});

describe('evidence', () => {
  it('sets the ceiling at a recognised idea held as inferred', () => {
    expect(EVIDENCE_CEILING).toBeCloseTo(0.275);
    expect(EVIDENCE_CEILING).toBeCloseTo(strength({ ...tested('recognised'), established: 'inferred', tested_at: null }, day(0)));
  });

  it('scores a link as its ceiling times its similarity, as a share of the ceiling', () => {
    // One clipping: 0.25 x 0.6 of recognised.
    expect(evidenceStrength([{ kind: 'clipping', ceiling: 0.25, similarity: 0.6 }])).toBeCloseTo(0.15 * EVIDENCE_CEILING);
    // Two notes: 1 - (1 - 0.2)(1 - 0.2), under the note ceiling of 0.5.
    const two = [
      { kind: 'note' as const, ceiling: 0.5, similarity: 0.4 },
      { kind: 'note' as const, ceiling: 0.5, similarity: 0.4 },
    ];
    expect(evidenceStrength(two)).toBeCloseTo(0.36 * EVIDENCE_CEILING);
  });

  it('never reads one kind past its ceiling, however many links', () => {
    const notes = Array.from({ length: 6 }, () => ({ kind: 'note' as const, ceiling: 0.5, similarity: 0.9 }));
    expect(evidenceStrength(notes)).toBeCloseTo(0.5 * EVIDENCE_CEILING);
    // A link cannot claim more than its kind allows, whatever its own ceiling says.
    expect(evidenceStrength([{ kind: 'clipping', ceiling: 1, similarity: 1 }])).toBeCloseTo(0.25 * EVIDENCE_CEILING);
  });

  it('combines kinds, never past the highest ceiling among them', () => {
    const mixed = [
      { kind: 'note' as const, ceiling: 0.5, similarity: 1 },
      { kind: 'clipping' as const, ceiling: 0.25, similarity: 1 },
    ];
    expect(evidenceStrength(mixed)).toBeCloseTo(0.5 * EVIDENCE_CEILING);
    const withWork = [...mixed, { kind: 'work' as const, ceiling: 1, similarity: 0.5 }];
    expect(evidenceStrength(withWork)).toBeCloseTo((1 - 0.5 * 0.75 * 0.5) * EVIDENCE_CEILING);
  });

  it('counts a mention for nothing', () => {
    expect(evidenceStrength([{ kind: 'mention', ceiling: 0, similarity: 1 }])).toBe(0);
  });

  it('never passes the ceiling, however strong the evidence', () => {
    const strong = Array.from({ length: 5 }, () => ({ kind: 'work' as const, ceiling: 1, similarity: 0.9 }));
    expect(evidenceStrength(strong)).toBeLessThanOrEqual(EVIDENCE_CEILING);
    expect(evidenceStrength(strong)).toBeCloseTo(EVIDENCE_CEILING);
    expect(strengthWithEvidence(null, strong, day(0))).toBeLessThanOrEqual(EVIDENCE_CEILING);
  });

  it('leaves out a link found after the day asked about', () => {
    const later = [{ kind: 'work' as const, ceiling: 1, similarity: 0.7, foundAt: day(10).toISOString() }];
    expect(evidenceStrength(later, day(5))).toBe(0);
    expect(evidenceStrength(later, day(10))).toBeCloseTo(0.7 * EVIDENCE_CEILING);
  });

  it('lights an untested idea and leaves a tested one as its questions left it', () => {
    const links = [{ kind: 'work' as const, ceiling: 1, similarity: 0.7 }];
    expect(isUntested(null)).toBe(true);
    expect(strengthWithEvidence({ ...tested('unknown'), established: 'inferred', tested_at: null }, links, day(0))).toBeCloseTo(
      0.7 * EVIDENCE_CEILING,
    );
    const shaky = tested('shaky');
    expect(isUntested(shaky)).toBe(false);
    expect(strengthWithEvidence(shaky, links, day(0))).toBeCloseTo(strength(shaky, day(0)));
  });

  it('keeps a declared idea above what evidence gives', () => {
    const declared: StrengthInput = { ...tested('known'), established: 'declared', tested_at: null, declared_at: T0 };
    expect(strengthWithEvidence(declared, [{ kind: 'work', ceiling: 1, similarity: 0.9 }], day(0))).toBeCloseTo(0.6);
  });

  it('keeps a misconception at nought', () => {
    const wrong = { ...tested('misconception'), established: 'inferred' as const, tested_at: null };
    expect(strengthWithEvidence(wrong, [{ kind: 'work', ceiling: 1, similarity: 0.9 }], day(0))).toBe(0);
  });
});

describe('where an answer leaves an idea, read with how sure you were (plan #2522.3)', () => {
  it('leaves the idea where it was on a right guess', () => {
    expect(stateAfterAnswer('recognised', { correct: true, confidence: 0.25 })).toBeNull();
    expect(stateAfterAnswer('known', { correct: true, confidence: 0.25 })).toBeNull();
  });

  it('moves the idea on a right answer given with any other confidence, or none', () => {
    expect(stateAfterAnswer('recognised', { correct: true, confidence: 0.5 })).toBe('recognised');
    expect(stateAfterAnswer('known', { correct: true, confidence: null })).toBe('known');
  });

  it('counts a miss at Guessing as a miss', () => {
    expect(stateAfterAnswer('shaky', { correct: false, confidence: 0.25 })).toBe('shaky');
  });
});
