import { describe, expect, it } from 'vitest';
import {
  outOfDateSteps,
  questionKey,
  readQuestions,
  readSources,
  recordName,
  sourcesLine,
} from './answers';
import type { CollectionField } from './collections';
import { buildForest, type Step } from './steps';
import type { Goal } from './tree';

const FIELDS: CollectionField[] = [
  { key: 'loan_id', label: 'Loan ID', type: 'text', id: true },
  { key: 'name', label: 'Loan', type: 'text' },
  { key: 'balance', label: 'Balance', type: 'money' },
];

const A = '2c04a4df-3837-4b4f-8b8d-e9ed51ea8410';
const B = '57c0b782-aa80-41dd-84d3-a54fe91bbdb5';

const RECORDS = [
  { id: A, data: { loan_id: '*****8042P25', name: 'Grad PLUS 2024–25', balance: 80080.21 } },
  { id: B, data: { loan_id: '*****8042P26', name: 'Grad PLUS 2025–26', balance: 78900.15 } },
];

describe('readSources', () => {
  it('reads the stored shape and leaves out what does not fit', () => {
    expect(
      readSources([
        { record_id: A, as_of: '2026-09-02' },
        { record_id: 'nope', as_of: '2026-09-02' },
        { record_id: B },
        'x',
      ]),
    ).toEqual([{ recordId: A, asOf: '2026-09-02' }]);
    expect(readSources(null)).toEqual([]);
  });
});

describe('recordName', () => {
  it('names a row by its first value, passing over the ID', () => {
    expect(recordName(FIELDS, RECORDS[0])).toBe('Grad PLUS 2024–25');
    expect(recordName(FIELDS, { id: 'x', data: { loan_id: '1' } })).toBe('a row without a name');
  });
});

describe('sourcesLine', () => {
  it('names the rows and one date when they share it', () => {
    expect(
      sourcesLine(
        [
          { recordId: A, asOf: '2026-09-02' },
          { recordId: B, asOf: '2026-09-02' },
        ],
        FIELDS,
        RECORDS,
      ),
    ).toBe('From Grad PLUS 2024–25 and Grad PLUS 2025–26, figures as of Sep 2, 2026');
  });

  it('dates each row when they differ, and counts a row since archived', () => {
    expect(
      sourcesLine(
        [
          { recordId: A, asOf: '2026-09-02' },
          { recordId: B, asOf: '2026-10-02' },
          { recordId: '00000000-0000-0000-0000-000000000000', asOf: '2026-08-01' },
        ],
        FIELDS,
        RECORDS,
      ),
    ).toBe(
      'From Grad PLUS 2024–25 (Sep 2, 2026), Grad PLUS 2025–26 (Oct 2, 2026) and a row since archived (Aug 1, 2026)',
    );
  });
});

function goal(id: string, status: Goal['status'] = 'open'): Goal {
  return {
    id,
    areaId: 'area',
    title: `Goal ${id}`,
    acceptance: null,
    fog: null,
    status,
    position: 10,
    unit: null,
    target: null,
  };
}

function step(id: string, parentId: string, status: Step['status'] = 'open'): Step {
  return {
    id,
    parentId,
    kind: 'mine',
    title: `Step ${id}`,
    status,
    detail: null,
    acceptance: null,
    resolution: null,
    dismissedAt: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
  } as Step;
}

describe('outOfDateSteps', () => {
  it('lists the steps with an answer out of date, under open goals, done or not', () => {
    const goals = [goal('g'), goal('closed', 'done')];
    const { byGoal } = buildForest(
      ['g', 'closed'],
      [step('loans', 'g', 'done'), step('gone', 'g', 'dropped'), step('other', 'closed')],
    );
    const answers = [
      { itemId: 'loans', question: 'What is the monthly total?', outOfDateAt: '2026-09-25T00:00:00Z' },
      { itemId: 'loans', question: 'When do payments start?', outOfDateAt: null },
      { itemId: 'gone', question: 'Dropped?', outOfDateAt: '2026-09-25T00:00:00Z' },
      { itemId: 'other', question: 'Closed goal?', outOfDateAt: '2026-09-25T00:00:00Z' },
    ];
    expect(outOfDateSteps(goals, byGoal, answers)).toEqual([
      { id: 'loans', title: 'Step loans', goalTitle: 'Goal g', questions: ['What is the monthly total?'] },
    ]);
  });
});

describe('readQuestions', () => {
  it('keeps well-formed questions in order and drops the rest', () => {
    expect(
      readQuestions([
        { key: 'first_payment', question: 'When does my first payment fall due?' },
        { key: 'Bad Key', question: 'x' },
        { key: 'monthly_total', question: '  ' },
        { key: 'first_payment', question: 'Again?' },
        'loose',
        { key: 'monthly_total', question: 'What is the monthly total?' },
      ]),
    ).toEqual([
      { key: 'first_payment', question: 'When does my first payment fall due?' },
      { key: 'monthly_total', question: 'What is the monthly total?' },
    ]);
    expect(readQuestions(null)).toEqual([]);
  });
});

describe('questionKey', () => {
  it('makes a key from the words', () => {
    expect(questionKey('What is the monthly total?', [])).toBe('what_is_the_monthly_total');
    expect(questionKey('2nd loan: when?', [])).toBe('nd_loan_when');
    expect(questionKey('???', [])).toBe('question');
  });

  it('stays within the key length and numbers a repeat', () => {
    const key = questionKey('How much interest is building up every single day on the loans?', []);
    expect(key.length).toBeLessThanOrEqual(36);
    expect(key).toMatch(/^[a-z][a-z0-9_]*[a-z0-9]$/);
    expect(questionKey('Monthly total?', ['monthly_total', 'monthly_total_2'])).toBe('monthly_total_3');
  });
});
