import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FigureAnswer } from '@/components/learn/figure-answer';
import { chartKind } from './kinds/chart';
import { tableKind, type TableSpec } from './kinds/table';
import type { ChartData } from './kinds/chart-data';
import { cellNumber, gradeCell } from './questions/fill-cell';
import { directionAfter } from './questions/predict-direction';
import { pickDiagramForm, rightPlace } from './questions/pick-diagram';
import {
  figureAnswerLabel,
  figureQuestionOffers,
  figureQuestionView,
  figureQuestionWriterLines,
  figureResponse,
  gradeFigureQuestion,
  poseFigureQuestion,
  readStoredFigureQuestion,
  type StoredFigureQuestion,
} from './question';
import type { FigureResolveContext } from './types';

const noFetch: FigureResolveContext = { series: async () => null };

describe('the figure question forms (plan #2321.5)', () => {
  it('offers fill_cell on the table and predict_direction on the chart', () => {
    const offered = figureQuestionOffers().map(({ kind, form }) => `${kind.id}/${form.id}`);
    expect(offered).toContain('table/fill_cell');
    expect(offered).toContain('chart/predict_direction');
  });

  for (const { kind, form } of figureQuestionOffers()) {
    describe(`${form.id} on ${kind.id}`, () => {
      it('tells the writer its shape, after the kind’s', () => {
        expect(form.writerLine.startsWith(`${form.id}:`)).toBe(true);
        expect(figureQuestionWriterLines()).toContain(form.writerLine);
      });

      it('poses a question on the kind’s own example, with an answer the page is not sent', () => {
        expect(form.example, 'an example ask').toBeDefined();
        expect(form.schema.safeParse(form.example).success).toBe(true);
        const posed = form.pose({ spec: kind.example.spec, resolved: kind.example.resolved, ask: form.example });
        expect(posed).not.toBeNull();
        const stored: StoredFigureQuestion = { kind: kind.id, form: form.id, caption: kind.example.caption, ...posed!, spec: posed!.spec };
        const view = figureQuestionView(stored)!;
        expect(JSON.stringify(view)).not.toContain(`"answer"`);
        expect(gradeFigureQuestion(stored, posed!.answer)).toBe('met');
      });
    });
  }
});

describe('fill the cell', () => {
  const spec = tableKind.example.spec;
  const form = tableKind.questions![0];

  it('blanks the named cell and keeps what it held as the answer', () => {
    const posed = form.pose({ spec, resolved: undefined, ask: { row: 1, column: 2, prompt: 'What does the café take at £3.60?' } })!;
    expect((posed.spec as TableSpec).rows[1]).toEqual(['£3.60', '90', '?']);
    expect(posed.answer).toBe('£324');
    expect(posed.choices).toBeUndefined();
  });

  it('refuses a cell that is not there or is empty', () => {
    expect(form.pose({ spec, resolved: undefined, ask: { row: 5, column: 0, prompt: 'Which row is missing here?' } })).toBeNull();
    expect(form.pose({ spec, resolved: undefined, ask: { row: 0, column: 3, prompt: 'Which column is missing here?' } })).toBeNull();
    const empty = { ...spec, rows: [['£3.20', '', '£320']] };
    expect(form.pose({ spec: empty, resolved: undefined, ask: { row: 0, column: 1, prompt: 'How many cups a day then?' } })).toBeNull();
  });

  it('grades the same text or the same number itself, and leaves the rest to the model', () => {
    expect(gradeCell('£324', '£324')).toBe('met');
    expect(gradeCell('£324', ' 324.0 ')).toBe('met');
    expect(gradeCell('1,200', '1200')).toBe('met');
    expect(gradeCell('£324', '£320')).toBeNull();
    expect(gradeCell('£324', '£500')).toBe('not_met');
    expect(gradeCell('Fixed cost', 'fixed cost.')).toBe('met');
    expect(gradeCell('Fixed cost', 'overhead')).toBeNull();
    expect(cellNumber('(12)')).toBe(-12);
    expect(cellNumber('About 25%')).toBeNull();
  });
});

describe('which way next', () => {
  const resolved = chartKind.example.resolved as ChartData;
  const form = chartKind.questions![0];
  const india = resolved.lines[0];

  it('reads the answer from the fetched numbers and cuts the chart at the year', () => {
    const posed = form.pose({ spec: chartKind.example.spec, resolved, ask: { cutAt: 2010, subject: 'India’s life expectancy' } })!;
    expect(posed.answer).toBe('rose');
    expect(posed.prompt).toBe('The chart stops at 2010. From 2010 to 2023, what did India’s life expectancy do?');
    const shown = posed.resolved as ChartData;
    expect(shown.to).toBe(2010);
    expect(shown.lines.every((line) => line.points.every((point) => point.year <= 2010))).toBe(true);
    expect(posed.choices?.map((choice) => choice.value)).toEqual(['rose', 'fell', 'level']);
  });

  it('asks nothing when the move is too small to call or there is too little before the cut', () => {
    // 2019 to 2023 in India: 70.7 to 72, under the five per cent a rise needs.
    expect(directionAfter(india, 2019)).toBeNull();
    expect(directionAfter(india, 1991)).toBeNull();
    expect(directionAfter(india, 2023)).toBeNull();
    const flat = { ...india, points: [1, 2, 3, 4].map((at) => ({ year: 2000 + at, value: 100 + at * 0.1 })) };
    expect(directionAfter(flat, 2003)).toBe('level');
  });

  it('is graded on the choice alone', () => {
    expect(form.grade('rose', 'rose')).toBe('met');
    expect(form.grade('rose', 'fell')).toBe('not_met');
  });
});

describe('pick the diagram', () => {
  const right = tableKind.example.spec;
  const wrong = [
    { ...right, rows: [right.rows[1], right.rows[0]] },
    { ...right, rows: [['£3.20', '100', '£300'], right.rows[1]] },
  ];
  const form = pickDiagramForm(tableKind.schema, { prompt: 'Which table adds up?', wrong }, 'table');

  it('puts the right one in a place fixed by the question, and sends the page none of it as the figure', () => {
    const posed = form.pose({ spec: right, resolved: undefined, ask: { prompt: 'Which table adds up?', wrong } })!;
    const at = rightPlace(JSON.stringify([right, wrong]), 3);
    expect(posed.answer).toBe(['A', 'B', 'C'][at]);
    expect(posed.choices![at].spec).toEqual(right);
    expect(posed.choices!.map((choice) => choice.label)).toEqual(['Table A', 'Table B', 'Table C']);
    const stored: StoredFigureQuestion = { kind: 'table', form: 'fill_cell', caption: 'A café’s takings.', ...posed };
    // Stored under a form the table has, so the view can be read; the pick's own figure goes as its caption alone.
    expect(figureQuestionView(stored)!.figure.spec).toBeNull();
    expect(gradeFigureQuestion(stored, posed.answer)).toBe('met');
    expect(gradeFigureQuestion(stored, posed.answer === 'A' ? 'B' : 'A')).toBe('not_met');
  });

  it('refuses options that are the same diagram', () => {
    expect(form.pose({ spec: right, resolved: undefined, ask: { prompt: 'Which table adds up?', wrong: [right, wrong[0]] } })).toBeNull();
  });
});

describe('a posed question', () => {
  it('is posed from what the writer wrote, and refuses what does not parse', async () => {
    const posed = await poseFigureQuestion(
      { kind: 'table', form: 'fill_cell', caption: ' A café’s  takings. ', spec: tableKind.example.spec, ask: { row: 0, column: 2, prompt: 'What does the café take at £3.20?' } },
      noFetch,
    );
    expect(posed).toMatchObject({ kind: 'table', form: 'fill_cell', caption: 'A café’s takings.', answer: '£320' });
    expect(await poseFigureQuestion({ kind: 'table', form: 'predict_direction', caption: 'x', spec: tableKind.example.spec, ask: {} }, noFetch)).toBeNull();
    expect(await poseFigureQuestion({ kind: 'table', form: 'fill_cell', caption: 'A table.', spec: { columns: [] }, ask: { row: 0, column: 0, prompt: 'What goes in here then?' } }, noFetch)).toBeNull();
  });

  it('asks nothing of a chart whose series cannot be fetched', async () => {
    const written = { kind: 'chart', form: 'predict_direction', caption: 'India’s life expectancy.', spec: chartKind.example.spec, ask: { cutAt: 2010, subject: 'India’s life expectancy' } };
    expect(await poseFigureQuestion(written, noFetch)).toBeNull();
  });

  it('is read back from its row, and a pick is kept and said by its label', () => {
    const stored = readStoredFigureQuestion({
      kind: 'chart',
      form: 'predict_direction',
      caption: 'India’s life expectancy.',
      spec: {},
      prompt: 'What did it do?',
      choices: [
        { value: 'rose', label: 'It rose' },
        { value: 'fell', label: 'It fell' },
      ],
      answer: 'rose',
    })!;
    expect(figureResponse(stored, 'fell')).toBe('It fell');
    expect(figureResponse(stored, 'sideways')).toBeNull();
    expect(figureAnswerLabel(stored)).toBe('It rose');
    expect(readStoredFigureQuestion({ kind: 'chart' })).toBeNull();
    expect(readStoredFigureQuestion(null)).toBeNull();
  });
});

describe('the answer control', () => {
  it('draws the blank table open with a box for the answer', () => {
    const posed = tableKind.questions![0].pose({ spec: tableKind.example.spec, resolved: undefined, ask: tableKind.questions![0].example! })!;
    const view = figureQuestionView({ kind: 'table', form: 'fill_cell', caption: 'A café’s takings.', ...posed })!;
    const html = renderToStaticMarkup(<FigureAnswer questionId="q" question={view} />);
    expect(html).toContain('<table');
    expect(html).not.toContain('<details');
    expect(html).toContain('name="response"');
    expect(html).not.toContain('£324');
  });
});
