import { describe, expect, it } from 'vitest';
import { nextQuestion, outstandingCount, type OpeningSweep } from './opening';

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
