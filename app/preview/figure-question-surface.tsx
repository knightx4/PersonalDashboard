'use client';

import { ANSWER_CELL_PAID, CellAnswerView, type AskedCellView, type CellAnswerState } from '@/components/learn/cell-answer-view';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { HAIKU } from '@/lib/core/models';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { chartKind } from '@/lib/learn/figures/kinds/chart';
import { explorableKind } from '@/lib/learn/figures/kinds/explorable';
import { tableKind } from '@/lib/learn/figures/kinds/table';
import { figureQuestionView, type FigureQuestionView, type StoredFigureQuestion } from '@/lib/learn/figures/question';
import { pickDiagramForm } from '@/lib/learn/figures/questions/pick-diagram';
import type { Moved } from '@/lib/learn/levels/grade';

/**
 * Figure questions in Practice Flow (plan #2321.5): a table with a blank
 * cell to fill, a chart cut at a year with a pick of which way it went, and
 * a pick of the right figure among three, each posed by its form from the
 * kind's own example; and the blank table once graded, missed, with the
 * answer under the summary.
 *
 * The pick is drawn with tables as its options, since the diagram kinds it
 * is meant for land with plan #2321.2; the control is the same whatever the
 * options are.
 */

const gradeCost: CostEstimate = { lowMicros: 0, medianMicros: 0, highMicros: 2_000, runs: 0, basis: 'guess', per: 'run', models: [HAIKU] };
const NEXT = '/learn/now?practice=1';

function posedView(stored: Omit<StoredFigureQuestion, 'prompt' | 'answer'>, posed: { spec: unknown; resolved?: unknown; prompt: string; choices?: StoredFigureQuestion['choices']; answer: string }): FigureQuestionView {
  return figureQuestionView({ ...stored, ...posed })!;
}

const fill = tableKind.questions![0];
const fillView = posedView(
  { kind: 'table', form: fill.id, caption: 'A café’s takings before and after it raises the price of a flat white.', spec: null },
  fill.pose({ spec: tableKind.example.spec, resolved: undefined, ask: fill.example! })!,
);

const predict = chartKind.questions![0];
const predictView = posedView(
  { kind: 'chart', form: predict.id, caption: 'Life expectancy at birth in India and the UK.', spec: null },
  predict.pose({ spec: chartKind.example.spec, resolved: chartKind.example.resolved!, ask: predict.example! })!,
);

const right = tableKind.example.spec;
const wrong = [
  { ...right, rows: [['£3.20', '100', '£320'], ['£3.60', '90', '£360']] },
  { ...right, rows: [['£3.20', '100', '£300'], ['£3.60', '90', '£324']] },
];
const pickAsk = { prompt: 'Which table shows the café’s takings worked out correctly?', wrong };
const pickPosed = pickDiagramForm(tableKind.schema, pickAsk, 'table').pose({ spec: right, resolved: undefined, ask: pickAsk })!;
const pickView: FigureQuestionView = {
  label: 'Pick the table',
  figure: { kind: 'table', caption: 'A café’s takings at two prices, worked out three ways.', spec: null },
  prompt: pickPosed.prompt,
  choices: pickPosed.choices!.map((choice) => ({
    value: choice.value,
    label: choice.label,
    figure: { kind: 'table', caption: choice.label, spec: choice.spec },
  })),
};

/* Which way a model's number moves (plan #2321.8): each urban model drawn still, with a change described. */
const move = explorableKind.questions![0];
const bidRentView = posedView(
  { kind: 'explorable', form: move.id, caption: 'Rent against distance from the centre of a city with one centre.', spec: null },
  move.pose({
    spec: { model: 'bid_rent', start: {} },
    resolved: undefined,
    ask: { move: { rail: 15 }, measure: 'edge', change: 'A new rail line opens, running 15 km out from the centre.' },
  })!,
);
const agglomerationView = posedView(
  { kind: 'explorable', form: move.id, caption: 'Output per worker against the size of a city.', spec: null },
  move.pose({
    spec: { model: 'agglomeration', start: {} },
    resolved: undefined,
    ask: { move: { congestion: 3 }, measure: 'best_size', change: 'The city builds a metro, and each million more people now costs each worker less in crowding and commuting.' },
  })!,
);

const base = { topicName: 'Price elasticity of demand', format: 'figure' as const };

type Form = 'fill' | 'predict' | 'pick' | 'move-bid-rent' | 'move-agglomeration';

const ASKED: Record<Form, AskedCellView> = {
  fill: { ...base, questionId: '00000000-0000-4000-8000-000000023215', level: 2, question: fillView.prompt, figure: fillView },
  predict: {
    questionId: '00000000-0000-4000-8000-000000023216',
    topicName: 'Demographic transition',
    level: 3,
    format: 'figure',
    question: predictView.prompt,
    figure: predictView,
  },
  pick: { ...base, questionId: '00000000-0000-4000-8000-000000023217', level: 2, question: pickView.prompt, figure: pickView },
  'move-bid-rent': {
    questionId: '00000000-0000-4000-8000-000000023218',
    topicName: 'The shape of the city',
    level: 3,
    format: 'figure',
    question: bidRentView.prompt,
    figure: bidRentView,
  },
  'move-agglomeration': {
    questionId: '00000000-0000-4000-8000-000000023219',
    topicName: 'Why density pays',
    level: 3,
    format: 'figure',
    question: agglomerationView.prompt,
    figure: agglomerationView,
  },
};

const missed: Moved = {
  reached: [
    {
      cellId: 'pe2',
      topicName: 'Price elasticity of demand',
      level: 2,
      how: 'missed',
      asked: true,
      quote: null,
      via: null,
      descriptor: ['Works out takings from a price and the quantity sold at it'],
    },
  ],
  doubted: [],
};

export function FigureQuestionPreview({ form, graded = false, reasoning = false }: { form: Form; graded?: boolean; reasoning?: boolean }) {
  // With `reasoning`, a choice made and the box for how you got there opened (plan #2522.2).
  const state: CellAnswerState = graded
    ? { moved: missed, error: null, response: '£360', answer: '£324' }
    : reasoning
      ? {
          moved: null,
          error: null,
          howSure: { confidence: 0.5, reasoning: 'B, since takings should go up when the price does.' },
        }
      : { moved: null, error: null };
  return (
    <PaidCostsProvider costs={{ [ANSWER_CELL_PAID]: gradeCost }}>
      <CellAnswerView asked={ASKED[form]} state={state} nextHref={NEXT} />
    </PaidCostsProvider>
  );
}
