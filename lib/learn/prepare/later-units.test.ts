import { describe, expect, it } from 'vitest';
import type { Territory, TerritoryTopic } from '@/lib/learn/levels/territory';
import { citeWeeks, laterTopics, matchedWeeks, topicsTaught } from './later-units';

/**
 * The units after the opening ones are written from the territory (plan
 * #2307.5): the call reads the topics no unit names yet, with the weeks that
 * teach each, and the unit cites the weeks of the topics it names.
 */

const topic = (ask: string, from: string[]): TerritoryTopic => ({ ask, scope: `${ask} scope.`, frame: 'Economics', target: 4, from });

const territory: Territory = {
  key: 'econ',
  name: 'Economics',
  subjectLens: 'Economics',
  performances: [],
  roles: [],
  texts: [
    { key: 'mit', label: 'MIT 14.01', items: ['Week 1: supply and demand', 'Week 2: elasticity', 'Week 3: taxes.'] },
    { key: 'lse', label: 'LSE EC1A', items: ['Lecture 4: incidence'] },
  ],
  topics: [
    topic('Supply and demand', ['mit: Week 1: supply and demand']),
    topic('What is elasticity', ['mit: Week 2: elasticity']),
    topic('Tax incidence', ['mit: Week 3: taxes.', 'lse: Lecture 4: incidence', 'gone: Week 9: nothing']),
    topic('Price controls', []),
  ],
};

describe('matchedWeeks', () => {
  it('names each from line by its document, leaving out a text the territory does not hold', () => {
    expect(matchedWeeks(territory.topics[2].from, territory.texts)).toEqual([
      'MIT 14.01: Week 3: taxes.',
      'LSE EC1A: Lecture 4: incidence',
    ]);
  });
});

describe('laterTopics', () => {
  it('skips the topics a unit already names, by drafted name, and keeps territory order', () => {
    const names = new Map([['what is elasticity', 'Price elasticity']]);
    const later = laterTopics(territory, names, [{ title: 'Markets', covers: 'Supply and demand, and how prices clear.' }]);
    expect(later.map((t) => t.name)).toEqual(['Price elasticity', 'Tax incidence', 'Price controls']);
    expect(later[0].weeks).toEqual(['MIT 14.01: Week 2: elasticity']);
  });

  it('stops at the limit', () => {
    expect(laterTopics(territory, new Map(), [], 2)).toHaveLength(2);
  });
});

describe('citeWeeks', () => {
  it('cites the weeks of the topics the unit names after what it covers', () => {
    const later = laterTopics(territory, new Map(), []);
    const taught = topicsTaught({ title: 'Who pays a tax', covers: 'Tax incidence and price controls.' }, later);
    expect(taught.map((t) => t.name)).toEqual(['Tax incidence', 'Price controls']);
    expect(citeWeeks('Tax incidence and price controls.', taught)).toEqual({
      covers: 'Tax incidence and price controls. Follows MIT 14.01: Week 3: taxes; LSE EC1A: Lecture 4: incidence.',
      weeks: ['MIT 14.01: Week 3: taxes.', 'LSE EC1A: Lecture 4: incidence'],
    });
  });

  it('cites nothing when the unit names no topic, and drops weeks that would make covers too long', () => {
    expect(citeWeeks('Something else.', [])).toEqual({ covers: 'Something else.', weeks: [] });
    const long = 'x'.repeat(360);
    const cited = citeWeeks(long, [{ name: 'T', scope: '', weeks: ['Doc: Week 1', 'Doc: Week 2', 'Doc: Week 3'] }]);
    expect(cited.weeks).toEqual(['Doc: Week 1', 'Doc: Week 2']);
    expect(cited.covers.length).toBeLessThanOrEqual(400);
  });
});
