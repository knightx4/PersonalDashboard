'use client';

import { ANSWER_CELL_PAID, CellAnswerView, type AskedCellView, type CellAnswerState } from '@/components/learn/cell-answer-view';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { HAIKU } from '@/lib/core/models';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { chartKind } from '@/lib/learn/figures/kinds/chart';
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

const base = { topicName: 'Price elasticity of demand', format: 'figure' as const };

const ASKED: Record<'fill' | 'predict' | 'pick', AskedCellView> = {
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

export function FigureQuestionPreview({ form, graded = false }: { form: 'fill' | 'predict' | 'pick'; graded?: boolean }) {
  const state: CellAnswerState = graded ? { moved: missed, error: null, response: '£360', answer: '£324' } : { moved: null, error: null };
  return (
    <PaidCostsProvider costs={{ [ANSWER_CELL_PAID]: gradeCost }}>
      <CellAnswerView asked={ASKED[form]} state={state} nextHref={NEXT} />
    </PaidCostsProvider>
  );
}
