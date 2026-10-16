import { describe, expect, it } from 'vitest';
import { themeOffers } from '@/lib/learn/levels/theme-offer';

const cell = (topicId: string, level: number) => ({
  cellId: `${topicId}${level}`,
  topicId,
  topicName: topicId.toUpperCase(),
  level,
});
const base = {
  missed: [cell('a', 3), cell('a', 5), cell('b', 2)],
  topicFields: new Map([
    ['a', ['f1']],
    ['b', ['f1']],
  ]),
  themes: [{ id: 't1', name: 'Rates', fieldId: 'f1', strength: 2 }],
  lensTopics: new Set<string>(),
  declined: new Set<string>(),
  ceilings: new Map([
    ['a', 4],
    ['b', 10],
  ]),
};

describe('themeOffers', () => {
  it('offers the theme with each topic at its highest missed level, within the ceiling', () => {
    expect(themeOffers(base)).toEqual([
      {
        themeId: 't1',
        themeName: 'Rates',
        topics: [
          { topicId: 'a', name: 'A', level: 4 },
          { topicId: 'b', name: 'B', level: 2 },
        ],
      },
    ]);
  });
  it('offers nothing when a lens already holds a topic in the theme field', () => {
    const topicFields = new Map([...base.topicFields, ['c', ['f1']]]);
    expect(themeOffers({ ...base, topicFields, lensTopics: new Set(['c']) })).toEqual([]);
  });
  it('offers nothing for a declined theme or topics with no field', () => {
    expect(themeOffers({ ...base, declined: new Set(['t1']) })).toEqual([]);
    expect(themeOffers({ ...base, topicFields: new Map() })).toEqual([]);
  });
  it('gives a topic to the strongest theme only', () => {
    const themes = [...base.themes, { id: 't2', name: 'Bonds', fieldId: 'f1', strength: 5 }];
    expect(themeOffers({ ...base, themes }).map((o) => o.themeId)).toEqual(['t2']);
  });
});
