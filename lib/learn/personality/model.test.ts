import { describe, expect, it } from 'vitest';
import { fromRow, parseTypedInput, type ResultRow } from './model';

const TODAY = '2026-10-07';

describe('parseTypedInput (plan #1633)', () => {
  it('names a Myers-Briggs or Enneagram test itself and keeps the type as written', () => {
    const parsed = parseTypedInput(
      { kind: 'mbti', testName: 'ignored', typedValue: '  intj-a ', takenAt: '2024-03-14' },
      TODAY,
    );
    expect(parsed).toEqual({
      input: {
        kind: 'mbti',
        testName: 'Myers-Briggs',
        typedValue: 'intj-a',
        takenAt: '2024-03-14',
        note: null,
      },
    });
    const enneagram = parseTypedInput(
      { kind: 'enneagram', typedValue: '5w4', takenAt: TODAY, note: ' Fits. ' },
      TODAY,
    );
    expect(enneagram).toMatchObject({ input: { testName: 'Enneagram', note: 'Fits.' } });
  });

  it('takes the name of another test from the form, and asks for one', () => {
    expect(
      parseTypedInput({ kind: 'other', testName: ' DISC ', typedValue: 'D', takenAt: TODAY }, TODAY),
    ).toMatchObject({ input: { kind: 'other', testName: 'DISC' } });
    expect(
      parseTypedInput({ kind: 'other', testName: '  ', typedValue: 'D', takenAt: TODAY }, TODAY),
    ).toMatchObject({ field: 'testName' });
  });

  it('refuses a Big Five row, an empty or long result, and a day that is not real or not yet', () => {
    expect(parseTypedInput({ kind: 'big_five', typedValue: 'x', takenAt: TODAY }, TODAY)).toMatchObject({
      field: 'testName',
    });
    expect(parseTypedInput({ kind: 'mbti', typedValue: ' ', takenAt: TODAY }, TODAY)).toMatchObject({
      field: 'typedValue',
    });
    expect(
      parseTypedInput({ kind: 'mbti', typedValue: 'x'.repeat(61), takenAt: TODAY }, TODAY),
    ).toMatchObject({ field: 'typedValue' });
    expect(
      parseTypedInput({ kind: 'mbti', typedValue: 'INTJ', takenAt: '2026-02-30' }, TODAY),
    ).toMatchObject({ field: 'takenAt' });
    expect(
      parseTypedInput({ kind: 'mbti', typedValue: 'INTJ', takenAt: '2026-10-08' }, TODAY),
    ).toMatchObject({ field: 'takenAt' });
    expect(
      parseTypedInput(
        { kind: 'mbti', typedValue: 'INTJ', takenAt: TODAY, note: 'x'.repeat(501) },
        TODAY,
      ),
    ).toMatchObject({ field: 'note' });
  });
});

describe('fromRow', () => {
  it('reads a typed-in row with its note', () => {
    const row: ResultRow = {
      id: 'a',
      kind: 'enneagram',
      test_name: 'Enneagram',
      answers: null,
      extraversion: null,
      agreeableness: null,
      conscientiousness: null,
      emotional_stability: null,
      intellect: null,
      typed_value: '5w4',
      note: 'From a book.',
      taken_at: '2025-11-02',
      created_at: '2026-10-07T18:31:00Z',
      read_points: null,
      read_model: null,
      read_at: null,
    };
    expect(fromRow(row)).toMatchObject({ kind: 'enneagram', typedValue: '5w4', note: 'From a book.' });
  });
});
