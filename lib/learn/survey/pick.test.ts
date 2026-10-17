import { describe, expect, it } from 'vitest';
import { tallySurvey } from './pick';

/** Counting the survey questions already asked, per theme and per field. */

describe('tallySurvey', () => {
  it('counts written and answered questions per theme and per field', () => {
    const counts = tallySurvey({
      subjects: [
        { id: 's-money', themeId: 'money' },
        { id: 's-stoicism', themeId: 'stoicism' },
        { id: 's-loose', themeId: 'unplaced' },
      ],
      placements: new Map([
        ['money', 'econ'],
        ['stoicism', 'phil'],
      ]),
      concepts: [
        { id: 'c1', subjectId: 's-money' },
        { id: 'c2', subjectId: 's-money' },
        { id: 'c3', subjectId: 's-stoicism' },
        { id: 'c4', subjectId: 's-loose' },
        { id: 'track-idea', subjectId: 'a-track' },
      ],
      probes: [
        { conceptId: 'c1', answered: true },
        { conceptId: 'c2', answered: false },
        { conceptId: 'c3', answered: false },
        { conceptId: 'c4', answered: true },
        { conceptId: 'track-idea', answered: true },
      ],
    });
    expect(counts.byField).toEqual(
      new Map([
        ['econ', { asked: 2, answered: 1 }],
        ['phil', { asked: 1, answered: 0 }],
      ]),
    );
    expect(counts.byTheme.get('unplaced')).toEqual({ asked: 1, answered: 1 });
    expect(counts.byTheme.has('track-idea')).toBe(false);
  });

  it("counts a goal's questions in the goal's field and in no theme", () => {
    const counts = tallySurvey({
      subjects: [
        { id: 's-money', themeId: 'money' },
        { id: 's-finance-goal', themeId: null, goalFieldId: 'econ' },
        { id: 's-unplaced-goal', themeId: null, goalFieldId: null },
      ],
      placements: new Map([['money', 'econ']]),
      concepts: [
        { id: 'c1', subjectId: 's-money' },
        { id: 'g1', subjectId: 's-finance-goal' },
        { id: 'g2', subjectId: 's-unplaced-goal' },
      ],
      probes: [
        { conceptId: 'c1', answered: false },
        { conceptId: 'g1', answered: true, answeredAt: '2026-10-01T09:00:00Z' },
        { conceptId: 'g2', answered: true },
      ],
    });
    expect(counts.byField).toEqual(
      new Map([['econ', { asked: 2, answered: 1, lastAnswered: '2026-10-01T09:00:00Z' }]]),
    );
    expect([...counts.byTheme.keys()]).toEqual(['money']);
  });
});
