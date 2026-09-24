import { describe, expect, it } from 'vitest';
import { nextUnitToOpen } from './lay-out-unit';

/**
 * Choosing the unit a track's next chain is written for (plan #977).
 */

const units = [
  { id: 'u3', ordinal: 3 },
  { id: 'u1', ordinal: 1 },
  { id: 'u2', ordinal: 2 },
];

describe('the next unit to open', () => {
  it('takes the first unit by ordinal when none is opened', () => {
    expect(nextUnitToOpen(units, [])?.id).toBe('u1');
  });

  it('skips units with a goal filed under them', () => {
    const goals = [
      { unitId: 'u1', status: 'active' },
      { unitId: 'u2', status: 'reached' },
    ];
    expect(nextUnitToOpen(units, goals)?.id).toBe('u3');
  });

  it('takes an earlier unopened unit over a later one, even when a later one is opened', () => {
    expect(nextUnitToOpen(units, [{ unitId: 'u1', status: 'active' }, { unitId: 'u3', status: 'active' }])?.id).toBe(
      'u2',
    );
  });

  it('treats a unit whose only goal was abandoned as unopened', () => {
    expect(nextUnitToOpen(units, [{ unitId: 'u1', status: 'abandoned' }])?.id).toBe('u1');
  });

  it('ignores goals asked outside the curriculum', () => {
    expect(nextUnitToOpen(units, [{ unitId: null, status: 'active' }])?.id).toBe('u1');
  });

  it('returns nothing when every unit is opened', () => {
    const goals = units.map((unit) => ({ unitId: unit.id, status: 'active' }));
    expect(nextUnitToOpen(units, goals)).toBeNull();
  });

  it('returns nothing for a track with no curriculum', () => {
    expect(nextUnitToOpen([], [])).toBeNull();
  });
});
