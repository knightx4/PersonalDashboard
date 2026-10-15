import type { ReactNode } from 'react';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { MODELS } from '@/lib/core/models';
import type { PieceIdea } from '@/lib/learn/lessons/piece-store';
import type { TodaysPiece } from '@/lib/learn/lessons/todays-piece-store';
import { PieceFirst } from '@/app/learn/now/todays-piece';
import { SummaryView } from '@/app/learn/flow/summary-card';
import { RUN_SUMMARY } from './learn-flow-summary-surfaces';

/**
 * Today's piece at the top of Now (plan #2164.4): its lessons one at a time,
 * the check after the last, the finished state, a lesson still being written,
 * one Dash could not write, and a goal with no pieces yet.
 */

const SUBJECT_ID = '5e000000-0000-4000-8000-000000000021';

const ideas: PieceIdea[] = [
  {
    conceptId: '5c000000-0000-4000-8000-000000000101',
    name: 'Net revenue retention, and why it can pass a hundred per cent',
    claim: 'Net revenue retention compares what last year’s customers pay now with what they paid then.',
    dropped: null,
    lesson: {
      takeaway:
        'Net revenue retention above 100% means the customers you already had pay you more this year than last, even after the ones who left.',
      context: 'It is the first number an investor asks a subscription business for, because it says whether growth needs new customers at all.',
      hook: null,
      summary:
        'Take the revenue a year ago from a group of customers, then their revenue today: upgrades and price rises add to it, downgrades and cancellations take away. Divide today by then.',
      example:
        'A team starts the year with customers paying £100,000. Upgrades add £18,000, cancellations take away £9,000 and downgrades £2,000, so the same customers pay £107,000: 107%.',
      question: 'A business loses a fifth of its customers’ revenue to churn but grows the rest by 30%. Is its retention above or below 100%?',
      answer: 'Above: 0.8 × 1.3 is 1.04, so 104%.',
    },
  },
  {
    conceptId: '5c000000-0000-4000-8000-000000000102',
    name: 'Gross revenue retention',
    claim: 'Gross retention counts only what was lost, so it can never pass a hundred per cent.',
    dropped: null,
    lesson: {
      takeaway: 'Gross revenue retention leaves upgrades out, so it shows only how much of last year’s revenue stayed.',
      context: null,
      hook: null,
      summary: 'Start from last year’s revenue, subtract cancellations and downgrades, divide by last year. It tops out at 100%.',
      example: 'The team above keeps £89,000 of its £100,000 before upgrades: gross retention of 89%.',
      question: null,
      answer: null,
    },
  },
  {
    conceptId: '5c000000-0000-4000-8000-000000000103',
    name: 'Cohorts',
    claim: 'A cohort is the customers who started in the same month, followed together over time.',
    dropped: null,
    lesson: {
      takeaway: 'Reading retention by cohort shows whether newer customers stay better or worse than older ones.',
      context: null,
      hook: null,
      summary: 'Group customers by the month they started and plot what each group pays month by month.',
      example: null,
      question: null,
      answer: null,
    },
  },
];

function piece(over: { ideas?: PieceIdea[]; check?: boolean } = {}): TodaysPiece {
  return {
    kind: 'piece',
    goalName: 'SaaS and subscription business metrics',
    page: {
      piece: { id: '5d000000-0000-4000-8000-000000000201', ordinal: 3, title: 'Retention: who stays and what they pay', passedAt: null },
      subject: { id: SUBJECT_ID, name: 'SaaS and subscription business metrics' },
      unit: { id: '5d000000-0000-4000-8000-000000000301', ordinal: 2, title: 'Keeping customers', outcome: null },
      siblings: [],
      ideas: over.ideas ?? ideas,
      check: over.check
        ? {
            id: '5d000000-0000-4000-8000-000000000401',
            question:
              'A business keeps 92% of last year’s revenue before upgrades, and its net retention is 112%. What do the two numbers together tell you about its customers?',
            expected: 'Few customers leave or downgrade, and those who stay spend noticeably more: upgrades add about 20 points.',
            response:
              'Hardly anyone leaves, and the ones who stay pay a lot more, about a fifth more from upgrades.',
            correct: true,
            why: 'Right: you read gross retention as what was lost and the gap to net as what upgrades added.',
          }
        : null,
    },
  };
}

const RUN = {
  lowMicros: 2_000,
  medianMicros: 4_000,
  highMicros: 9_000,
  runs: 14,
  basis: 'measured',
  per: 'run',
  models: [MODELS.learnProbe],
} as const;

function Costs({ children }: { children: ReactNode }) {
  return (
    <PaidCostsProvider
      costs={{
        'app/learn/s/[id]/p/[piece]/actions.ts#askPieceCheck': RUN,
        'app/learn/s/[id]/p/[piece]/actions.ts#answerPieceCheck': RUN,
      }}
    >
      {children}
    </PaidCostsProvider>
  );
}

/** The piece on its first lesson, as Now opens. */
export function TodaysPieceSurface() {
  return (
    <Costs>
      <PieceFirst piece={piece()}>{null}</PieceFirst>
    </Costs>
  );
}

/** Every lesson read: the check, not yet asked. */
export function TodaysPieceCheckSurface() {
  return (
    <Costs>
      <PieceFirst piece={piece()} lessonsPassed={ideas.length}>
        {null}
      </PieceFirst>
    </Costs>
  );
}

/** The check answered right: the finished state. */
export function TodaysPieceDoneSurface() {
  return (
    <Costs>
      <PieceFirst
        piece={piece({ check: true })}
        lessonsPassed={ideas.length}
        summary={<SummaryView summary={RUN_SUMMARY} />}
      >
        {null}
      </PieceFirst>
    </Costs>
  );
}

/** The first lesson still being written. */
export function TodaysPieceLoadingSurface() {
  return (
    <Costs>
      <PieceFirst
        piece={piece({ ideas: ideas.map((idea, index) => (index < 2 ? { ...idea, lesson: null } : idea)) })}
        write={false}
      >
        {null}
      </PieceFirst>
    </Costs>
  );
}

/** A lesson Dash could not write. */
export function TodaysPieceErrorSurface() {
  return (
    <Costs>
      <PieceFirst
        piece={piece({
          ideas: [
            { ...ideas[0]!, lesson: null, dropped: 'the idea’s sources disagree on how upgrades are counted.' },
            ...ideas.slice(1),
          ],
        })}
      >
        {null}
      </PieceFirst>
    </Costs>
  );
}

/** A goal with no pieces written yet, above the cards. */
export function TodaysPieceNoneSurface({ cards }: { cards: ReactNode }) {
  return (
    <PieceFirst piece={{ kind: 'no-pieces', goalName: 'Financial modeling in Excel for operators', subjectId: SUBJECT_ID }}>
      {cards}
    </PieceFirst>
  );
}
