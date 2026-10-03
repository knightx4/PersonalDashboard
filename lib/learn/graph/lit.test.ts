import { describe, expect, it } from 'vitest';
import { isLit, litRecently } from './lit';

const now = new Date('2026-10-03T12:00:00Z');

describe('isLit', () => {
  it('lights known and sharp, and nothing else', () => {
    expect(isLit({ state: 'known' })).toBe(true);
    expect(isLit({ state: 'sharp' })).toBe(true);
    expect(isLit({ state: 'recognised' })).toBe(false);
    expect(isLit({ state: 'misconception' })).toBe(false);
    expect(isLit({ state: 'unknown' })).toBe(false);
  });
});

describe('litRecently', () => {
  it('plays for a concept answered about this week', () => {
    expect(
      litRecently({ state: 'known', testedAt: '2026-10-01T09:00:00Z', declaredAt: null }, now),
    ).toBe(true);
  });

  it('plays for a concept you said you knew this week', () => {
    expect(
      litRecently({ state: 'known', testedAt: null, declaredAt: '2026-10-03T11:00:00Z' }, now),
    ).toBe(true);
  });

  it('does not play for one known long ago, or with no date', () => {
    expect(
      litRecently({ state: 'known', testedAt: '2026-03-01T09:00:00Z', declaredAt: null }, now),
    ).toBe(false);
    expect(litRecently({ state: 'known', testedAt: null, declaredAt: null }, now)).toBe(false);
  });

  it('does not play for a concept that is not known', () => {
    expect(
      litRecently({ state: 'shaky', testedAt: '2026-10-02T09:00:00Z', declaredAt: null }, now),
    ).toBe(false);
  });
});
