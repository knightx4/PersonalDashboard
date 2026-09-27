import { describe, expect, it } from 'vitest';
import type { PieceForCheck } from './piece-check';
import {
  handedInSomething,
  lineUpFigures,
  MAX_FIGURES,
  MAX_ROWS,
  piecePasses,
  practicePrompt,
  toPracticeView,
  toWrittenPractice,
  type HandInRow,
  type PracticePayload,
  type PracticeRow,
} from './practice';

const piece: PieceForCheck = {
  trackName: 'SaaS metrics',
  unitTitle: 'Retention',
  unitOutcome: 'Read a cohort grid and say what it shows.',
  pieceTitle: 'Net revenue retention',
  ideas: [
    { name: 'Expansion revenue', claim: 'Existing customers can pay more over time.' },
    { name: 'Net revenue retention', claim: 'Revenue kept from a cohort, counting expansion and churn.' },
  ],
};

const payload: PracticePayload = {
  task: '  Work out net revenue retention for the January cohort.  ',
  columns: ['Month', 'MRR'],
  rows: [
    ['January', 1000],
    ['December', '1,120', 'extra cell'],
    ['', ''],
  ],
  figures: [
    { label: 'NRR', unit: '%' },
    { label: 'nrr', unit: '%' },
    { label: ' ', unit: null },
  ],
  points: [' NRR is 112%, within a point. ', '', 'Says expansion outran churn.'],
  worked: 'NRR = 1,120 / 1,000 = 112%.',
  spreadsheet_note: ' ',
};

describe('practicePrompt', () => {
  it('gives the piece and what its written lessons taught, leaving out lessons not yet written', () => {
    const prompt = practicePrompt(
      piece,
      [
        { name: 'Expansion revenue', takeaway: 'Upgrades add revenue from customers you have.', example: 'A seat upgrade.' },
        { name: 'Net revenue retention', takeaway: null, example: null },
      ],
      'report_practice',
    );
    expect(prompt).toContain('This piece of it: Net revenue retention');
    expect(prompt).toContain('- Expansion revenue: Upgrades add revenue from customers you have.');
    expect(prompt).toContain('  Example used: A seat upgrade.');
    expect(prompt).not.toContain('- Net revenue retention: \n');
    expect(prompt.endsWith('Call report_practice.')).toBe(true);
  });

  it('leaves the lessons section out when none is written', () => {
    expect(practicePrompt(piece, [], 'report_practice')).not.toContain('What the lessons taught:');
  });
});

describe('toWrittenPractice', () => {
  it('trims the task, drops empty points, names each figure once and fits the table to its header', () => {
    const checked = toWrittenPractice(payload);
    expect(checked).toEqual({
      ok: true,
      practice: {
        task: 'Work out net revenue retention for the January cohort.',
        data: {
          columns: ['Month', 'MRR'],
          rows: [
            ['January', '1000'],
            ['December', '1,120'],
          ],
        },
        figures: [{ label: 'NRR', unit: '%' }],
        points: ['NRR is 112%, within a point.', 'Says expansion outran churn.'],
        worked: 'NRR = 1,120 / 1,000 = 112%.',
        spreadsheetNote: null,
      },
    });
  });

  it('caps the figures and the rows', () => {
    const many = toWrittenPractice({
      ...payload,
      figures: Array.from({ length: 10 }, (_, index) => ({ label: `F${index}` })),
      rows: Array.from({ length: 20 }, (_, index) => [`r${index}`, index]),
    });
    expect(many.ok && many.practice.figures).toHaveLength(MAX_FIGURES);
    expect(many.ok && many.practice.data?.rows).toHaveLength(MAX_ROWS);
  });

  it('keeps no table when there are no columns, and keeps a spreadsheet note', () => {
    const plain = toWrittenPractice({ ...payload, columns: [], spreadsheet_note: ' A real bridge runs across twelve months. ' });
    expect(plain.ok && plain.practice.data).toBeNull();
    expect(plain.ok && plain.practice.spreadsheetNote).toBe('A real bridge runs across twelve months.');
  });

  it('refuses a task with no text, no points or no worked answer', () => {
    expect(toWrittenPractice({ ...payload, task: ' ' }).ok).toBe(false);
    expect(toWrittenPractice({ ...payload, points: [' '] }).ok).toBe(false);
    expect(toWrittenPractice({ ...payload, worked: '' }).ok).toBe(false);
  });
});

describe('toPracticeView', () => {
  const row: PracticeRow = {
    id: 'p1',
    task: 'Work out NRR.',
    data: { columns: ['Month', 'MRR'], rows: [['January', '1000']] },
    figures: [{ label: 'NRR', unit: '%' }],
    points: ['NRR is 112%.'],
    worked: 'NRR = 112%.',
    spreadsheet_note: null,
  };
  const handIn: HandInRow = {
    id: 'h1',
    answer: 'Divided.',
    figures: [{ label: 'NRR', value: '110%' }],
    marks: [{ point: 'NRR is 112%.', met: false, note: 'Check which months you divided.' }],
    passed: false,
    created_at: '2026-09-27T00:00:00Z',
  };

  it('keeps the points and the worked answer off the page until the practice is passed', () => {
    const view = toPracticeView(row, handIn, false);
    expect(view.worked).toBeNull();
    expect(JSON.stringify(view)).not.toContain('NRR is 112%.');
    expect(view.latest?.marks).toEqual([{ met: false, note: 'Check which months you divided.' }]);
    expect(toPracticeView(row, handIn, true).worked).toBe('NRR = 112%.');
  });
});

describe('lineUpFigures', () => {
  it('keeps the asked figures in order, matched by label, and drops any not asked for', () => {
    expect(
      lineUpFigures(
        [
          { label: 'NRR', unit: '%' },
          { label: 'GRR', unit: '%' },
        ],
        [
          { label: 'extra', value: '1' },
          { label: 'grr', value: ' 91% ' },
        ],
      ),
    ).toEqual([
      { label: 'NRR', value: '' },
      { label: 'GRR', value: '91%' },
    ]);
  });
});

describe('handedInSomething', () => {
  it('needs working or at least one filled figure', () => {
    expect(handedInSomething(' ', [{ label: 'NRR', value: ' ' }])).toBe(false);
    expect(handedInSomething('', [{ label: 'NRR', value: '112%' }])).toBe(true);
    expect(handedInSomething('Divided.', [])).toBe(true);
  });
});

describe('piecePasses', () => {
  it('needs both the practice and the check', () => {
    expect(piecePasses({ practicePassed: true, checkPassed: true })).toBe(true);
    expect(piecePasses({ practicePassed: true, checkPassed: false })).toBe(false);
    expect(piecePasses({ practicePassed: false, checkPassed: true })).toBe(false);
  });
});
