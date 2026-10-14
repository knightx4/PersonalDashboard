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

  it('combines links as one minus the product of what each leaves out', () => {
    // One clipping at a quarter weight: 0.25 x 0.6.
    expect(evidenceStrength([{ weight: 0.25, similarity: 0.6 }])).toBeCloseTo(0.15);
    // Two: 1 - (1 - 0.1)(1 - 0.1).
    const two = [
      { weight: 0.25, similarity: 0.4 },
      { weight: 0.25, similarity: 0.4 },
    ];
    expect(evidenceStrength(two)).toBeCloseTo(0.19);
  });

  it('never passes the ceiling, however strong the evidence', () => {
    const strong = Array.from({ length: 5 }, () => ({ weight: 1, similarity: 0.9 }));
    expect(evidenceStrength(strong)).toBe(EVIDENCE_CEILING);
    expect(strengthWithEvidence(null, strong, day(0))).toBe(EVIDENCE_CEILING);
  });

  it('leaves out a link found after the day asked about', () => {
    const later = [{ weight: 1, similarity: 0.7, foundAt: day(10).toISOString() }];
    expect(evidenceStrength(later, day(5))).toBe(0);
    expect(evidenceStrength(later, day(10))).toBeCloseTo(EVIDENCE_CEILING);
  });

  it('lights an untested idea and leaves a tested one as its questions left it', () => {
    const links = [{ weight: 1, similarity: 0.7 }];
    expect(isUntested(null)).toBe(true);
    expect(strengthWithEvidence({ ...tested('unknown'), established: 'inferred', tested_at: null }, links, day(0))).toBeCloseTo(
      EVIDENCE_CEILING,
    );
    const shaky = tested('shaky');
    expect(isUntested(shaky)).toBe(false);
    expect(strengthWithEvidence(shaky, links, day(0))).toBeCloseTo(strength(shaky, day(0)));
  });

  it('keeps a declared idea above what evidence gives', () => {
    const declared: StrengthInput = { ...tested('known'), established: 'declared', tested_at: null, declared_at: T0 };
    expect(strengthWithEvidence(declared, [{ weight: 1, similarity: 0.9 }], day(0))).toBeCloseTo(0.6);
  });

  it('keeps a misconception at nought', () => {
    const wrong = { ...tested('misconception'), established: 'inferred' as const, tested_at: null };
    expect(strengthWithEvidence(wrong, [{ weight: 1, similarity: 0.9 }], day(0))).toBe(0);
  });
});
