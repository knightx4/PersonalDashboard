'use client';

import { MoveReviewView } from '@/app/learn/topics/review/review-view';
import type { MoveRow } from '@/lib/learn/levels/move';
import type { MoveReview, MoveState } from '@/lib/learn/levels/move-store';

/**
 * Moving the claims graph onto topics (plan #2138.4): the review page with
 * each hidden part the step lists drawn on its own surface. The list with a
 * failed subject, downward edges and unsure placements; the run part way
 * through; and the page before anything has moved.
 */

function subjects(moved: number, failed: number, waiting: number): MoveRow[] {
  const names = [
    'Corporate finance',
    'Macroeconomics and the transmission of monetary policy through bank lending',
    'Urban transport networks',
    'Building codes',
    'Behavioural economics',
    'Statistics',
    'Philosophy of science',
  ];
  const rows: MoveRow[] = [];
  let n = 0;
  // The failed subject is always the one with the longest name.
  const name = () => (status === 'failed' ? names[1] : names[n % names.length]);
  let status: MoveRow['status'] = 'moved';
  for (let i = 0; i < moved; i += 1, n += 1) rows.push({ subjectId: `s${n}`, subjectName: name(), status: 'moved', detail: null });
  status = 'failed';
  for (let i = 0; i < failed; i += 1, n += 1)
    rows.push({
      subjectId: `s${n}`,
      subjectName: name(),
      status: 'failed',
      detail: 'Dash could not place the ideas. Rate limited. Try again shortly.',
    });
  status = 'waiting';
  for (let i = 0; i < waiting; i += 1, n += 1) rows.push({ subjectId: `s${n}`, subjectName: name(), status: 'waiting', detail: null });
  return rows;
}

const REVIEWS: MoveReview[] = [
  {
    id: 'r1',
    kind: 'edge',
    subjectName: 'Corporate finance',
    why: 'On Discounted cash flow, Free cash flow sits at level 3, above Terminal value at level 2, which needs it.',
    conceptId: 'c1',
    conceptName: 'Terminal value',
    claim: null,
    prerequisiteName: 'Free cash flow',
    topicId: 't1',
    topicName: 'Discounted cash flow',
    level: 2,
    ceiling: 10,
    prerequisiteLevel: 3,
  },
  {
    id: 'r2',
    kind: 'assignment',
    subjectName: 'Corporate finance',
    why: 'This could sit on Capital asset pricing model instead; it reads as the input to it rather than the model.',
    conceptId: 'c2',
    conceptName: 'Equity risk premium',
    claim: 'The return investors demand above the risk-free rate for holding the market rather than a government bond, which is estimated, not observed.',
    prerequisiteName: null,
    topicId: 't2',
    topicName: 'Cost of equity',
    level: 3,
    ceiling: 8,
    prerequisiteLevel: null,
  },
  {
    id: 'r3',
    kind: 'assignment',
    subjectName: 'Urban transport networks',
    why: "Dash put it at level 9, above where Braess's paradox stops, so it sits at 7.",
    conceptId: 'c3',
    conceptName: 'Selfish routing equilibrium',
    claim: 'When every driver picks their own fastest route, the network settles where no one can do better alone, which can be slower for all.',
    prerequisiteName: null,
    topicId: 't3',
    topicName: "Braess's paradox",
    level: 7,
    ceiling: 7,
    prerequisiteLevel: null,
  },
];

const LIST: MoveState = { rows: subjects(118, 1, 8), reviews: REVIEWS, topicsMade: 64 };

export function LearnTopicsReviewPreview() {
  return <MoveReviewView state={LIST} />;
}

export function LearnTopicsReviewRunningPreview() {
  return (
    <MoveReviewView
      state={{ rows: subjects(40, 0, 87), reviews: REVIEWS.slice(1, 2), topicsMade: 22 }}
      running={{ done: 40, total: 87, current: 'Macroeconomics and the transmission of monetary policy through bank lending' }}
    />
  );
}

export function LearnTopicsReviewEmptyPreview() {
  return <MoveReviewView state={{ rows: subjects(0, 0, 127), reviews: [], topicsMade: 0 }} />;
}
