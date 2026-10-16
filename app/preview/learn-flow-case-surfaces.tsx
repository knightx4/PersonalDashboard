'use client';

import { CaseCard } from '@/app/learn/flow/case-card';
import type { FlowState } from '@/app/learn/flow/state';

/**
 * Practice Flow's worked case (plan #2164.3), drawn from fixtures for the
 * gallery: the case before an answer, and after it with the grader's sentence
 * and the answer expected. The forms post nowhere here.
 */

export type CaseStage = 'ask' | 'answered';

const QUESTION: FlowState = {
  probeId: '00000000-0000-4000-8000-0000000000c1',
  conceptId: '00000000-0000-4000-8000-0000000000c2',
  conceptName: 'A burn multiple above two is a warning sign',
  subjectId: '00000000-0000-4000-8000-0000000000c3',
  subjectName: 'Startup finance for founders and first-time operators',
  goal: { aimId: '00000000-0000-4000-8000-0000000000c4', aimName: 'Startup finance for founders' },
  case: true,
  options: [],
  question:
    'Northwind burned $6m last year and added $2m of new ARR. This year it plans to burn $6m again, and the sales team ' +
    'expects to add $1.5m.\n\nWhat will its burn multiple be this year, and what would you tell the founder?',
};

const ANSWERED: FlowState = {
  ...QUESTION,
  answered: {
    correct: true,
    reason: 'You worked out four, and saw that the same spending now buys less new revenue.',
    response: 'Six over 1.5 is four, up from three. Growth got more expensive, so I would cut spend or fix sales.',
    expected: 'Four, up from three: the same $6m burn buys $1.5m of new ARR instead of $2m.',
    weight: 1,
  },
};

const noop = () => {};

export function FlowCasePreview({ stage }: { stage: CaseStage }) {
  return (
    <div className="pb-[calc(var(--dock-h)+env(safe-area-inset-bottom))] lg:pb-0">
      <CaseCard live={stage === 'ask' ? QUESTION : ANSWERED} step={noop} fields={null} onEnd={noop} />
    </div>
  );
}
