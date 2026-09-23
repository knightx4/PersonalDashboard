import { describe, expect, it } from 'vitest';
import {
  FEW,
  SURVEY_LEAST,
  SURVEY_MOST,
  fieldsWrittenAbout,
  surveyShare,
  surveySlots,
  type SurveyField,
} from './rate';

/**
 * Decision #839: up to one question in two about a subject that is not a
 * track while some field you write about is untested, tapering to one in five
 * once every field has a few answers.
 */

const field = (answered: number, trackTested = false): SurveyField => ({ answered, trackTested });

describe('surveyShare', () => {
  it('is zero with no fields to survey', () => {
    expect(surveyShare([])).toBe(0);
  });

  it('is one in two while any field has no answered question', () => {
    expect(surveyShare([field(0)])).toBe(SURVEY_MOST);
    expect(surveyShare([field(FEW), field(FEW), field(0)])).toBe(SURVEY_MOST);
  });

  it('counts a field a track has tested as answered', () => {
    expect(surveyShare([field(0, true), field(FEW)])).toBe(SURVEY_LEAST);
  });

  it('tapers with the share of fields still short of a few answers', () => {
    expect(surveyShare([field(1), field(1)])).toBeCloseTo(SURVEY_MOST);
    expect(surveyShare([field(1), field(FEW)])).toBeCloseTo(0.35);
    expect(surveyShare([field(FEW), field(FEW + 4)])).toBeCloseTo(SURVEY_LEAST);
  });
});

describe('surveySlots', () => {
  it('asks nothing from the survey at a zero rate', () => {
    expect(surveySlots([], 0, 3)).toEqual([false, false, false]);
  });

  it('alternates at one in two', () => {
    expect(surveySlots([], SURVEY_MOST, 4)).toEqual([true, false, true, false]);
    expect(surveySlots([true], SURVEY_MOST, 3)).toEqual([false, true, false]);
  });

  it('asks one in five at the lowest rate, counting what came before', () => {
    expect(surveySlots([false, false, true], SURVEY_LEAST, 3)).toEqual([false, false, true]);
    const run = surveySlots([], SURVEY_LEAST, 10);
    expect(run.filter(Boolean)).toHaveLength(2);
    expect(run[0]).toBe(true);
    expect(run[5]).toBe(true);
  });

  it('asks one in three in between', () => {
    expect(surveySlots([false, false], 0.35, 3)).toEqual([true, false, false]);
  });
});

describe('fieldsWrittenAbout', () => {
  it('lists each field with a theme once, with its counts', () => {
    const fields = fieldsWrittenAbout({
      themes: [
        { id: 'a', name: 'a', strength: 1, fieldId: 'econ', hasNotes: true },
        { id: 'b', name: 'b', strength: 1, fieldId: 'econ', hasNotes: false },
        { id: 'c', name: 'c', strength: 1, fieldId: 'bio', hasNotes: true },
      ],
      trackTestedFields: new Set(['bio']),
      counts: { byField: new Map([['econ', { asked: 4, answered: 2 }]]), byTheme: new Map() },
    });
    expect(fields).toEqual([
      { answered: 2, trackTested: false },
      { answered: 0, trackTested: true },
    ]);
  });
});
