import { describe, expect, it } from 'vitest';
import { ideaRowFrom } from '@/lib/ideas/load';
import { isSureScore, scoreFrom } from '@/lib/ideas/score';

const row = (score: unknown) => ({
  id: 'i1',
  body: 'an idea',
  module: 'dev',
  created_at: '2026-09-30T09:00:00Z',
  source: 'me',
  dismissed_at: null,
  plan_item: null,
  from_plan_item: null,
  score,
});

describe('an idea score', () => {
  it('reads back a stored score', () => {
    const stored = { value: 72.5, confidence: 0.91, at: '2026-09-30T09:00:01Z' };
    expect(scoreFrom(stored)).toEqual(stored);
    expect(ideaRowFrom(row(stored)).score).toEqual(stored);
  });

  it('reads as null when the idea has none', () => {
    expect(ideaRowFrom(row(null)).score).toBeNull();
    expect(ideaRowFrom(row(undefined)).score).toBeNull();
  });

  it('reads a value that is not this shape as null', () => {
    expect(scoreFrom({ value: 140, confidence: 0.9, at: 'x' })).toBeNull();
    expect(scoreFrom({ value: '50', confidence: 0.9, at: 'x' })).toBeNull();
    expect(scoreFrom({ value: 50, at: 'x' })).toBeNull();
    expect(scoreFrom({ value: 50, confidence: 0.9 })).toBeNull();
    expect(scoreFrom('50')).toBeNull();
  });

  it('is unsure under 0.8', () => {
    expect(isSureScore({ value: 50, confidence: 0.8, at: 'x' })).toBe(true);
    expect(isSureScore({ value: 50, confidence: 0.79, at: 'x' })).toBe(false);
    expect(isSureScore(null)).toBe(false);
  });
});
