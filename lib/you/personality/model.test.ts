import { describe, expect, it } from 'vitest';
import { enneagramLine, fromRow, themesFrom, parseTypedInput, type ResultRow } from './model';

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
        typeScores: null,
        themes: null,
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

describe('Enneagram scores', () => {
  const NINE = ['64', '60', '82', '35', '100', '18', '98', '45', '99'];

  it('keeps all nine and fills a blank result with the top type', () => {
    expect(
      parseTypedInput({ kind: 'enneagram', typedValue: ' ', takenAt: TODAY, typeScores: NINE }, TODAY),
    ).toMatchObject({
      input: { typedValue: '5', typeScores: [64, 60, 82, 35, 100, 18, 98, 45, 99] },
    });
  });

  it('keeps a typed result beside the scores, and takes none at all', () => {
    expect(
      parseTypedInput({ kind: 'enneagram', typedValue: '5w4', takenAt: TODAY, typeScores: NINE }, TODAY),
    ).toMatchObject({ input: { typedValue: '5w4' } });
    expect(
      parseTypedInput(
        { kind: 'enneagram', typedValue: '5', takenAt: TODAY, typeScores: Array(9).fill('') },
        TODAY,
      ),
    ).toMatchObject({ input: { typeScores: null } });
  });

  it('asks for every score once one is in, each from 0 to 100', () => {
    const some = [...NINE];
    some[2] = '';
    some[6] = '';
    expect(
      parseTypedInput({ kind: 'enneagram', typedValue: '5', takenAt: TODAY, typeScores: some }, TODAY),
    ).toEqual({ error: expect.stringContaining('Missing: 3, 7'), field: 'typeScores' });
    const high = [...NINE];
    high[0] = '101';
    expect(
      parseTypedInput({ kind: 'enneagram', typedValue: '5', takenAt: TODAY, typeScores: high }, TODAY),
    ).toEqual({ error: expect.stringContaining('type 1'), field: 'typeScores' });
  });

  it('ignores scores sent with another kind of test', () => {
    expect(
      parseTypedInput({ kind: 'mbti', typedValue: 'INTJ', takenAt: TODAY, typeScores: NINE }, TODAY),
    ).toMatchObject({ input: { typeScores: null } });
  });

  it('ranks highest first, a tie keeping the lower type first', () => {
    expect(enneagramLine([10, 50, 10, 0, 50, 0, 0, 0, 0])).toBe(
      '2 at 50, 5 at 50, 1 at 10, 3 at 10, 4 at 0, 6 at 0, 7 at 0, 8 at 0, 9 at 0',
    );
  });
});

describe('themesFrom', () => {
  it('reads ranked themes with their detail, and refuses a theme with no name', () => {
    expect(
      themesFrom([{ name: 'Learner', domain: 'Strategic Thinking', blind_spots: ['Too much', 3] }]),
    ).toEqual([
      {
        name: 'Learner',
        domain: 'Strategic Thinking',
        summary: null,
        score: null,
        insights: [],
        blindSpots: ['Too much'],
        actions: [],
      },
    ]);
    expect(themesFrom([{ domain: 'Executing' }])).toBeNull();
    expect(themesFrom([])).toBeNull();
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
    expect(fromRow(row)).toMatchObject({ kind: 'enneagram', typedValue: '5w4', note: 'From a book.', typeScores: null });
    const scores = [64, 60, 82, 35, 100, 18, 98, 45, 99];
    expect(fromRow({ ...row, type_scores: scores })).toMatchObject({ typeScores: scores });
    expect(fromRow({ ...row, type_scores: [1, 2] })).toMatchObject({ typeScores: null });
  });
});
