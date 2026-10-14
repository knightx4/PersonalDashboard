import { describe, expect, it } from 'vitest';
import type { StrengthInput } from '@/lib/learn/strength';
import { countsOf, DAY_MS, mapOn, momentOf, stateRowOn, timelineSpan, type TimelineIdea } from './timeline';

const TODAY = new Date('2026-10-13T15:00:00Z');

const tested = (at: string): StrengthInput => ({
  state: 'known',
  established: 'tested',
  tested_at: at,
  declared_at: null,
  review_interval_days: null,
});

describe('timelineSpan', () => {
  it('runs from the start of the first idea’s day to today', () => {
    const span = timelineSpan([{ createdAt: '2026-10-10T18:00:00Z' }, { createdAt: '2026-10-12T01:00:00Z' }], TODAY);
    expect(new Date(span.start).toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(span.days).toBe(3);
  });

  it('has nothing to replay when every idea is from today or has no date', () => {
    expect(timelineSpan([{ createdAt: '2026-10-13T01:00:00Z' }, { createdAt: null }], TODAY).days).toBe(0);
    expect(timelineSpan([], TODAY).days).toBe(0);
  });

  it('never starts after today, even with a date in the future', () => {
    expect(timelineSpan([{ createdAt: '2026-11-01T00:00:00Z' }], TODAY).days).toBe(0);
  });
});

describe('momentOf', () => {
  const span = timelineSpan([{ createdAt: '2026-10-10T18:00:00Z' }], TODAY);

  it('is the end of the day, and today itself on the last step', () => {
    expect(momentOf(span, 0, TODAY).toISOString()).toBe('2026-10-10T23:59:59.999Z');
    expect(momentOf(span, 3, TODAY)).toBe(TODAY);
  });
});

describe('stateRowOn', () => {
  it('is nothing before the state was set and the row after', () => {
    const row = tested('2026-10-05T12:00:00Z');
    expect(stateRowOn(row, null, new Date('2026-10-04T00:00:00Z'))).toBeNull();
    expect(stateRowOn(row, null, new Date('2026-10-06T00:00:00Z'))).toBe(row);
  });

  it('shows an idea declared and later tested as declared between the two', () => {
    const row: StrengthInput = { ...tested('2026-10-08T00:00:00Z'), declared_at: '2026-10-02T00:00:00Z' };
    const between = stateRowOn(row, null, new Date('2026-10-05T00:00:00Z'));
    expect(between).toMatchObject({ established: 'declared', tested_at: null, declared_at: '2026-10-02T00:00:00Z' });
  });

  it('lights an idea with no date of its own on the day it was written', () => {
    const row: StrengthInput = { ...tested('x'), tested_at: null, established: 'inferred' };
    expect(stateRowOn(row, '2026-10-05T00:00:00Z', new Date('2026-10-04T00:00:00Z'))).toBeNull();
    expect(stateRowOn(row, '2026-10-05T00:00:00Z', new Date('2026-10-06T00:00:00Z'))).toBe(row);
  });
});

describe('mapOn', () => {
  const ideas: TimelineIdea[] = [
    { id: 'a', createdAt: '2026-10-01T00:00:00Z', stateRow: tested('2026-10-03T00:00:00Z'), neighbours: [{ id: 'b', similarity: 0.9 }] },
    { id: 'b', createdAt: '2026-10-02T00:00:00Z', stateRow: null, neighbours: [{ id: 'a', similarity: 0.9 }] },
    { id: 'c', createdAt: '2026-10-09T00:00:00Z', stateRow: null, neighbours: [] },
  ];

  it('leaves out ideas not written yet and keeps lit ones dark until their state is set', () => {
    const early = mapOn(ideas, new Date('2026-10-02T12:00:00Z'));
    expect([...early.keys()]).toEqual(['a', 'b']);
    expect(early.get('a')).toMatchObject({ strength: 0, state: 'unknown', stateRow: null });
    expect(early.get('b')!.haze).toBe(0);
  });

  it('lights an idea once tested and hazes its unknown neighbour', () => {
    const later = mapOn(ideas, new Date('2026-10-04T00:00:00Z'));
    expect(later.get('a')!.strength).toBeGreaterThan(0.7);
    expect(later.get('a')!.state).toBe('known');
    expect(later.get('b')!.haze).toBeGreaterThan(0);
    expect(later.has('c')).toBe(false);
  });

  it('fades a lit idea as the days pass', () => {
    const soon = mapOn(ideas, new Date('2026-10-04T00:00:00Z')).get('a')!.strength;
    const later = mapOn(ideas, new Date(Date.parse('2026-10-04T00:00:00Z') + 30 * DAY_MS)).get('a')!.strength;
    expect(later).toBeLessThan(soon);
  });
});

describe('countsOf', () => {
  it('counts the ideas, the lit ones and the mean strength', () => {
    expect(countsOf([{ strength: 0.5 }, { strength: 0 }, { strength: 0.25 }, { strength: 0.25 }])).toEqual({
      ideas: 4,
      lit: 3,
      averageStrength: 0.25,
    });
    expect(countsOf([])).toEqual({ ideas: 0, lit: 0, averageStrength: 0 });
  });
});
