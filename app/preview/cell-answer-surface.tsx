'use client';

import {
  CellAnswerView,
  type AskedCellView,
  type CellAnswerState,
} from '@/components/learn/cell-answer-view';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { ANSWER_CELL_PAID } from '@/components/learn/cell-answer-view';
import { HAIKU } from '@/lib/core/models';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import type { Moved, ReachedCell } from '@/lib/learn/levels/grade';

/** The grading call's guessed cost, as the Learn layout provides it (law 16). */
const gradeCost: CostEstimate = {
  lowMicros: 2_000,
  medianMicros: 4_000,
  highMicros: 7_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [HAIKU],
};

/**
 * The explain question about one level and its answer screen (plan #2138.5),
 * in each state the step names: asked, grading, failed, and graded with the
 * list of levels reached, once closed and once with a quote opened.
 */

const asked: AskedCellView = {
  questionId: '00000000-0000-4000-8000-000000002138',
  topicName: 'CAPM',
  level: 3,
  question: 'Explain how CAPM works. Take each part in turn and say why it is there.',
};

const answer =
  'CAPM says the return you should expect from a stock is the risk-free rate plus a premium for the risk you cannot diversify away. ' +
  'That premium is beta times the market risk premium: beta measures how much the stock moves with the market, and the market premium is what investors demand for holding the market at all. ' +
  'Only systematic risk is paid for, because anything specific to one company washes out in a diversified portfolio.';

function check(...lines: string[]): string[] {
  return lines;
}

const reached: ReachedCell[] = [
  {
    cellId: 'capm3',
    topicName: 'CAPM',
    level: 3,
    how: 'shown',
    asked: true,
    quote:
      'That premium is beta times the market risk premium: beta measures how much the stock moves with the market, and the market premium is what investors demand for holding the market at all.',
    via: null,
    descriptor: check(
      'Can say what each of the risk-free rate, beta and the market premium stands for',
      'Can explain why the premium is scaled by beta rather than by total volatility',
      'Can say why the risk-free rate is the starting point',
    ),
  },
  {
    cellId: 'sys2',
    topicName: 'Systematic and idiosyncratic risk',
    level: 2,
    how: 'shown',
    asked: false,
    quote:
      'Only systematic risk is paid for, because anything specific to one company washes out in a diversified portfolio.',
    via: null,
    descriptor: check(
      'Can define systematic risk',
      'Can say why diversification removes idiosyncratic risk',
    ),
  },
  {
    cellId: 'capm1',
    topicName: 'CAPM',
    level: 1,
    how: 'implied',
    asked: false,
    quote: null,
    via: { topicName: 'CAPM', level: 3 },
    descriptor: check('Can place CAPM in asset pricing', 'Can say what it is used for'),
  },
  {
    cellId: 'capm2',
    topicName: 'CAPM',
    level: 2,
    how: 'implied',
    asked: false,
    quote: null,
    via: { topicName: 'CAPM', level: 3 },
    descriptor: check('Can state the formula in words', 'Can say what expected return means here'),
  },
  {
    cellId: 'beta2',
    topicName: 'Beta',
    level: 2,
    how: 'implied',
    asked: false,
    quote: null,
    via: { topicName: 'CAPM', level: 3 },
    descriptor: check('Can define beta', 'Can read a beta above and below one'),
  },
  {
    cellId: 'rf1',
    topicName: 'Risk-free rate of return on government debt',
    level: 1,
    how: 'implied',
    asked: false,
    quote: null,
    via: { topicName: 'CAPM', level: 3 },
    descriptor: check('Can say what the risk-free rate is for', 'Can name where it is read from'),
  },
];

const moved: Moved = {
  reached,
  doubted: [{ from: { topicName: 'CAPM', level: 3 }, to: { topicName: 'Return', level: 2 } }],
};

const caseAsked: AskedCellView = {
  questionId: '00000000-0000-4000-8000-000000002139',
  topicName: 'Discounted cash flow',
  level: 4,
  format: 'case',
  question:
    'A company expects free cash flow of $120m next year, growing 5% a year for five years and then 2% for ever. ' +
    'Its cost of capital is 9%. It has $200m of net debt and 50m shares. Value one share, and show the steps you took.',
};

const caseAnswer =
  'Discount each of the five years at 9%, then add a terminal value of year-five cash flow times 1.02 over 0.07, discounted back five years. ' +
  'Enterprise value comes to about $1.9bn. Take off $200m of net debt and divide by 50m shares, which gives about $34 a share.';

const caseMoved: Moved = {
  reached: [
    {
      cellId: 'dcf4',
      topicName: 'Discounted cash flow',
      level: 4,
      how: 'shown',
      asked: true,
      quote: 'Take off $200m of net debt and divide by 50m shares, which gives about $34 a share.',
      via: null,
      descriptor: check(
        'Can build a DCF from given projections',
        'Can move from enterprise value to a value per share',
      ),
    },
  ],
  doubted: [],
};

const NEXT = '/learn/now?practice=1';

export function CellAnswerPreview({
  state,
  pending,
  openFirstQuote,
}: {
  state: 'asked' | 'loading' | 'error' | 'reached' | 'quote' | 'case' | 'case-reached';
  pending?: boolean;
  openFirstQuote?: boolean;
}) {
  const isCase = state === 'case' || state === 'case-reached';
  const drawn: CellAnswerState =
    state === 'case'
      ? { moved: null, error: null }
      : state === 'case-reached'
        ? { moved: caseMoved, error: null, response: caseAnswer }
        : state === 'asked'
          ? { moved: null, error: null }
          : state === 'loading'
            ? { moved: null, error: null, response: answer }
            : state === 'error'
              ? {
                  moved: null,
                  error: 'Dash could not grade this answer just now.',
                  response: answer,
                }
              : { moved, error: null };
  return (
    <PaidCostsProvider costs={{ [ANSWER_CELL_PAID]: gradeCost }}>
      <CellAnswerView
        asked={isCase ? caseAsked : asked}
        state={drawn}
        nextHref={NEXT}
        pending={pending ?? state === 'loading'}
        openFirstQuote={openFirstQuote ?? state === 'quote'}
      />
    </PaidCostsProvider>
  );
}
