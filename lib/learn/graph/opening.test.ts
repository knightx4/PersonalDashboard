import { describe, expect, it } from 'vitest';
import {
  matchSweepToConcepts,
  nextQuestion,
  outstandingCount,
  type OpeningSweep,
} from './opening';

/**
 * What a resumed sweep shows.
 *
 * A closed tab is the ordinary case here, not the edge case: ten written
 * answers is a few minutes, and the count on the screen is what somebody
 * decides by whether to keep going. Both rules turn on a pass counting as
 * reached -- somebody who pressed past every question has finished the sweep,
 * and telling them nine are left would send them round again.
 */

function sweep(outcomes: (OpeningSweep['questions'][number]['outcome'])[]): OpeningSweep {
  return {
    id: 'sweep',
    asked: 'keynesian economics',
    subjectName: 'Economics',
    subjectId: null,
    questions: outcomes.map((outcome, position) => ({
      id: `q${position}`,
      position,
      claimName: `Claim ${position}`,
      claim: 'Something somebody can be right or wrong about.',
      question: 'What does it rule out?',
      expected: 'The model answer.',
      response: outcome === 'right' || outcome === 'wrong' ? 'What I wrote.' : null,
      outcome,
    })),
  };
}

describe('how much of a sweep is left', () => {
  it('counts every question on a sweep nobody has started', () => {
    expect(outstandingCount(sweep([null, null, null]))).toBe(3);
  });

  it('counts a pass as reached', () => {
    expect(outstandingCount(sweep(['skipped', 'skipped', null]))).toBe(1);
  });

  it('is nothing left once every question has been reached', () => {
    expect(outstandingCount(sweep(['right', 'wrong', 'skipped']))).toBe(0);
  });
});

describe('which question comes next', () => {
  it('resumes at the first one not reached', () => {
    expect(nextQuestion(sweep(['right', 'skipped', null, null]))?.position).toBe(2);
  });

  it('does not go back for one that was passed', () => {
    expect(nextQuestion(sweep(['skipped', 'wrong', null]))?.position).toBe(2);
  });

  it('is nothing on a finished sweep', () => {
    expect(nextQuestion(sweep(['right', 'skipped']))).toBeNull();
  });
});

describe('what the answers make of your first chain', () => {
  /**
   * A concept marked known is one the views deliberately stop showing you, so
   * every rule here is about not marking one off a claim nobody checked: exact
   * matching, a pass changing nothing, and an unmatched claim counted rather
   * than quietly dropped.
   */
  function answered(entries: [string, OpeningSweep['questions'][number]['outcome']][]): OpeningSweep {
    return {
      id: 'sweep',
      asked: 'keynesian economics',
      subjectName: 'Economics',
      subjectId: null,
      questions: entries.map(([claimName, outcome], position) => ({
        id: `q${position}`,
        position,
        claimName,
        claim: 'Something somebody can be right or wrong about.',
        question: 'What does it rule out?',
        expected: 'The model answer.',
        response: outcome === 'right' || outcome === 'wrong' ? 'What I wrote.' : null,
        outcome,
      })),
    };
  }

  const CONCEPTS = [
    { id: 'c1', name: 'Wage stickiness' },
    { id: 'c2', name: 'Liquidity trap' },
    { id: 'c3', name: 'Velocity of money' },
  ];

  it('settles what you got right and leaves what you missed shaky', () => {
    const { states } = matchSweepToConcepts(
      answered([
        ['Wage stickiness', 'right'],
        ['Liquidity trap', 'wrong'],
      ]),
      CONCEPTS,
    );

    expect(states).toEqual([
      { conceptId: 'c1', state: 'known' },
      { conceptId: 'c2', state: 'shaky' },
    ]);
  });

  it('changes nothing for one you passed on', () => {
    const { states, unmatched } = matchSweepToConcepts(
      answered([['Wage stickiness', 'skipped']]),
      CONCEPTS,
    );

    expect(states).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  it('changes nothing for one not reached at all', () => {
    const { states } = matchSweepToConcepts(answered([['Wage stickiness', null]]), CONCEPTS);
    expect(states).toEqual([]);
  });

  it('matches past casing, punctuation and a leading article', () => {
    const { states } = matchSweepToConcepts(
      answered([['The wage-stickiness', 'right']]),
      CONCEPTS,
    );

    expect(states).toEqual([{ conceptId: 'c1', state: 'known' }]);
  });

  it('counts a claim the chain never proposed rather than guessing at it', () => {
    const { states, unmatched } = matchSweepToConcepts(
      answered([
        ['Wage stickiness', 'right'],
        ['Ricardian equivalence', 'right'],
      ]),
      CONCEPTS,
    );

    expect(states).toEqual([{ conceptId: 'c1', state: 'known' }]);
    expect(unmatched).toEqual(['Ricardian equivalence']);
  });

  it('leaves every concept alone when nothing was answered', () => {
    const { states, unmatched } = matchSweepToConcepts(answered([]), CONCEPTS);
    expect(states).toEqual([]);
    expect(unmatched).toEqual([]);
  });
});
