'use client';

import { ExplainCard } from '@/app/learn/flow/explain-card';
import type { FlowState } from '@/app/learn/flow/state';

/**
 * Practice Flow's explain question (plan #2164.2), drawn from fixtures for
 * the gallery: the prompt, the marks with the follow-up, the end after the
 * follow-up, marking in progress, and marking that failed. The forms post
 * nowhere here.
 */

export type ExplainStage = 'ask' | 'marked' | 'done' | 'grading' | 'error';

const QUESTION: FlowState = {
  probeId: '00000000-0000-4000-8000-0000000000e1',
  conceptId: '00000000-0000-4000-8000-0000000000e2',
  conceptName: 'A burn multiple above two is a warning sign',
  subjectId: '00000000-0000-4000-8000-0000000000e3',
  subjectName: 'Startup finance for founders and first-time operators',
  goal: { aimId: '00000000-0000-4000-8000-0000000000e4', aimName: 'Startup finance for founders' },
  explain: true,
  options: [],
  question:
    'Explain this idea to a friend in a few sentences: A burn multiple above two is a warning sign. ' +
    'Say what it means, why it holds, and give an example of your own. A full answer also works out the burn multiple from net burn and new ARR and ' +
    'says why a slowing growth rate worsens it.',
};

const EXPLANATION =
  'The burn multiple is how much cash you burn for each new dollar of recurring revenue. Above two means growth ' +
  'is expensive. If a company burns $6m in a year and adds $2m of new ARR, its multiple is three, which investors ' +
  'would read as a sign the growth is being bought.';

const MARKED: FlowState = {
  ...QUESTION,
  explanation: EXPLANATION,
  explained: {
    holds: true,
    right: [
      'You said it is net burn divided by new ARR',
      'Your example worked it out correctly as three',
    ],
    missing: ['Why slowing growth pushes it up even when spending is flat'],
    why: 'The explanation holds and the example is your own.',
    ownExample: true,
    followUp: {
      probeId: '00000000-0000-4000-8000-0000000000e5',
      question:
        'Spending stays at $6m a year but new ARR falls from $3m to $1.5m. What happens to the burn multiple, and what would you tell the founder?',
    },
    state: 'known',
  },
};

const DONE: FlowState = {
  ...MARKED,
  followUpAnswer:
    'It doubles from two to four, because the same burn now buys half the growth. I would tell them the spending is no longer paying for itself.',
  followedUp: {
    holds: true,
    right: ['You worked out that it doubles to four', 'You tied it to the same burn buying less growth'],
    missing: [],
    why: 'Right in substance.',
    state: 'sharp',
    claim: 'Investors treat burning more than two dollars per new dollar of ARR as a warning.',
  },
};

const STATES: Record<ExplainStage, FlowState> = {
  ask: QUESTION,
  marked: MARKED,
  done: DONE,
  grading: { ...QUESTION, explanation: EXPLANATION },
  error: {
    ...QUESTION,
    explanation: EXPLANATION,
    error: 'Marking failed: the marker did not answer. Your explanation is still here; send it again.',
  },
};

const noop = () => {};

export function FlowExplainPreview({ stage }: { stage: ExplainStage }) {
  // The room the app's shell leaves under a page for the phone's tab bar,
  // which the card's pinned row stops above.
  return (
    <div className="pb-[calc(var(--dock-h)+env(safe-area-inset-bottom))] lg:pb-0">
      <ExplainCard
        live={STATES[stage]}
        step={noop}
        fields={null}
        grading={stage === 'grading' ? 'explain' : undefined}
      />
    </div>
  );
}
