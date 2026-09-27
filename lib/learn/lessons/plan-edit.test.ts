import { describe, expect, it } from 'vitest';
import { describeUnitPrompt } from '@/lib/learn/graph/curriculum';
import { readUnitDescription, readUnitTitle } from '@/lib/learn/graph/curriculum-payload';
import { placeAfterStep } from './plan-edit';
import { planProgress, type PlanUnit } from './plan-view';

/**
 * Changing a goal's plan (plan #1144): where a unit lands when moved a step,
 * what a name typed for a new unit must be, what Dash is asked to write for
 * it, and that Next up follows the new order.
 */

const units = [
  { id: 'a', ordinal: 1 },
  { id: 'b', ordinal: 2 },
  { id: 'c', ordinal: 3 },
];

describe('moving a unit a step', () => {
  it('gives the place one up or one down', () => {
    expect(placeAfterStep(units, 'b', 'up')).toBe(1);
    expect(placeAfterStep(units, 'b', 'down')).toBe(3);
  });

  it('goes nowhere past either end, or for a unit not in the plan', () => {
    expect(placeAfterStep(units, 'a', 'up')).toBeNull();
    expect(placeAfterStep(units, 'c', 'down')).toBeNull();
    expect(placeAfterStep(units, 'z', 'up')).toBeNull();
  });

  it('reads places by ordinal, whatever order the rows came in', () => {
    expect(placeAfterStep([units[2], units[0], units[1]], 'c', 'up')).toBe(2);
  });
});

describe('a unit added by name', () => {
  it('keeps the title typed, with its spacing tidied', () => {
    expect(readUnitTitle('  Working   capital ', ['Cash flow'])).toEqual({ ok: true, title: 'Working capital' });
  });

  it('refuses an empty name, a long one, and one the plan already has', () => {
    expect(readUnitTitle('   ', [])).toMatchObject({ ok: false });
    expect(readUnitTitle('x'.repeat(81), [])).toMatchObject({ ok: false });
    expect(readUnitTitle('cash FLOW', ['Cash flow'])).toMatchObject({ ok: false });
  });

  it('asks Dash for what it covers beside the other units', () => {
    const prompt = describeUnitPrompt({
      subject: 'Finance',
      units: [{ title: 'Cash flow', covers: 'Where cash comes from.', outcome: 'Read a cash flow statement.' }],
      title: 'Working capital',
    });
    expect(prompt).toContain('1. Cash flow. Covers: Where cash comes from.');
    expect(prompt).toContain('The unit they added: Working capital');
  });

  it('reads what Dash wrote, and refuses a part missing', () => {
    expect(readUnitDescription({ covers: ' Inventory and  payables. ', outcome: 'Size a cash gap.' })).toEqual({
      ok: true,
      covers: 'Inventory and payables.',
      outcome: 'Size a cash gap.',
    });
    expect(readUnitDescription({ covers: 'x', outcome: ' ' })).toMatchObject({ ok: false });
    expect(readUnitDescription({ title: 'x' })).toMatchObject({ ok: false });
  });
});

describe('Next up after a move', () => {
  const unit = (id: string, ordinal: number, state: 'open' | 'passed'): PlanUnit => ({
    id,
    ordinal,
    title: id,
    covers: null,
    outcome: null,
    pieces: [{ id: `${id}-1`, ordinal: 1, title: `${id} piece`, state }],
  });

  it('is the first open piece in the new order', () => {
    expect(planProgress([unit('a', 1, 'open'), unit('b', 2, 'open')]).next?.pieceId).toBe('a-1');
    expect(planProgress([unit('a', 2, 'open'), unit('b', 1, 'open')]).next?.pieceId).toBe('b-1');
  });
});
