import { describe, expect, it } from 'vitest';
import { planExisting, unitsFromTheAdd, type ExistingSubject } from './existing';

const dash = { writtenByDash: true, pieces: 0 };
const base: ExistingSubject = { id: 'a', name: 'Urban economics', survey: false, runStatus: null, lensTargets: 0, units: [dash, dash, dash, dash] };

describe('planExisting', () => {
  it('opens a subject with no run and marks its add-written units', () => {
    expect(planExisting([base])).toEqual([expect.objectContaining({ action: 'open', replaceUnits: true })]);
  });
  it('skips surveys, prepared subjects and subjects with drafted topics', () => {
    const plans = planExisting([
      { ...base, id: '1', survey: true },
      { ...base, id: '2', runStatus: 'done' },
      { ...base, id: '3', lensTargets: 20 },
    ]);
    expect(plans.map((p) => p.action)).toEqual(['skip', 'skip', 'skip']);
  });
  it('prepares a drafted subject when it is named', () => {
    const plans = planExisting([{ ...base, lensTargets: 20 }], ['urban ECONOMICS']);
    expect(plans[0].action).toBe('open');
  });
  it('only prepares the named subject', () => {
    expect(planExisting([base, { ...base, id: 'b', name: 'Other' }], ['Other']).map((p) => p.id)).toEqual(['b']);
  });
  it('keeps outlined, typed or long unit lists', () => {
    expect(unitsFromTheAdd([{ writtenByDash: true, pieces: 3 }])).toBe(false);
    expect(unitsFromTheAdd([{ writtenByDash: false, pieces: 0 }])).toBe(false);
    expect(unitsFromTheAdd(Array(12).fill(dash))).toBe(false);
    expect(unitsFromTheAdd([])).toBe(false);
  });
});
