import { describe, expect, it } from 'vitest';
import { TEST_SLOTS, testSlots } from '@/app/you/personality/personality-section';
import type { TypedResult } from '@/lib/you/personality/model';

function typed(kind: TypedResult['kind'], testName: string, typedValue: string): TypedResult {
  return { id: `${testName}-${typedValue}`, kind, testName, typedValue } as TypedResult;
}

describe('testSlots (note 6502788f)', () => {
  it('keeps a slot for every listed test with nothing typed in', () => {
    expect(testSlots([]).map((slot) => slot.name)).toEqual(TEST_SLOTS.map((slot) => slot.name));
    expect(testSlots([]).every((slot) => slot.href && slot.results.length === 0)).toBe(true);
  });

  it('puts a result in its test’s slot, and another test after the listed ones', () => {
    const slots = testSlots([
      typed('mbti', 'Myers-Briggs', 'INTJ'),
      typed('other', 'cliftonstrengths', 'Learner'),
      typed('other', 'Holland Code', 'RIA'),
      typed('other', 'Holland Code', 'RIE'),
    ]);
    expect(slots.find((s) => s.name === 'Myers-Briggs')?.results.map((r) => r.typedValue)).toEqual(['INTJ']);
    expect(slots.find((s) => s.name === 'CliftonStrengths')?.results.map((r) => r.typedValue)).toEqual(['Learner']);
    expect(slots.at(-1)).toMatchObject({ name: 'Holland Code', href: null });
    expect(slots.at(-1)?.results).toHaveLength(2);
    expect(slots).toHaveLength(TEST_SLOTS.length + 1);
  });
});
