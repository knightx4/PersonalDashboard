'use client';

import { ReviewList } from '@/app/learn/review/review-list';
import { CommandPalette } from '@/components/shell/command-palette';
import { CaptureProvider } from '@/components/shell/capture';
import { AskDashProvider } from '@/components/shell/ask-dash';
import { ToastProvider } from '@/components/ui/toast';
import { SYSTEM_THEME } from '@/lib/theme';
import type { DueReview } from '@/lib/learn/lessons/review';

/**
 * Learn now's Due for review (note 9b011a39), folding under its heading with
 * the count on the closed line: a row with nothing asked, one with a question
 * waiting, and one with the longest names.
 */
const REVIEWS: DueReview[] = [
  {
    conceptId: 'c1',
    name: 'Compton scattering',
    subjectId: 's1',
    trackName: 'Quantum physics',
    pieceId: 'p1',
    pieceTitle: 'Light as particles',
    dueOn: '2026-10-15',
    open: null,
  },
  {
    conceptId: 'c2',
    name: 'Opportunity cost',
    subjectId: 's2',
    trackName: 'Economics',
    pieceId: null,
    pieceTitle: null,
    dueOn: '2026-10-14',
    open: {
      id: 'q2',
      question: 'You spend Saturday painting a fence instead of working a paid shift. What did the fence cost you?',
      expected: null,
      response: null,
      correct: null,
      why: null,
    },
  },
  {
    conceptId: 'c3',
    name: 'The difference between a sample statistic and the population parameter it estimates',
    subjectId: 's3',
    trackName: 'Statistics for working scientists',
    pieceId: 'p3',
    pieceTitle: 'Estimating from a sample without fooling yourself',
    dueOn: '2026-10-12',
    open: null,
  },
  {
    // Answered, with what was said about how sure (plan #2522.2).
    conceptId: 'c4',
    name: 'Marginal cost',
    subjectId: 's2',
    trackName: 'Economics',
    pieceId: null,
    pieceTitle: null,
    dueOn: '2026-10-11',
    open: {
      id: 'q4',
      question: 'A bakery already makes 200 loaves a day. What does the 201st loaf cost it?',
      expected: 'Only the extra flour, energy and time for that one loaf, not a share of the oven or the rent.',
      response: 'Just the ingredients and baking for one more loaf, since the oven is paid for anyway.',
      correct: true,
      why: 'The answer separates the cost of one more loaf from the costs already fixed.',
      howSure: { confidence: 0.75, reasoning: 'The oven is there whether or not it bakes one more.' },
    },
  },
];

/**
 * Review with one hint before the answer (plan #2522.7): a row with its hint
 * up and the first answer in the box, a row right after a hint, and a row
 * where Show the answer was pressed.
 */
const HINTED_REVIEWS: DueReview[] = [
  {
    conceptId: 'h1',
    name: 'Opportunity cost',
    subjectId: 's2',
    trackName: 'Economics',
    pieceId: null,
    pieceTitle: null,
    dueOn: '2026-10-14',
    open: {
      id: 'hq1',
      question: 'You spend Saturday painting a fence instead of working a paid shift. What did the fence cost you?',
      expected: null,
      response: null,
      correct: null,
      why: null,
      howSure: { confidence: 0.75, reasoning: null },
      hint: {
        hint: 'You have counted what you paid out. What else did the Saturday have in it that you gave up?',
        response: 'The price of the paint and brushes.',
      },
      hintsUsed: 1,
    },
  },
  {
    conceptId: 'h2',
    name: 'Marginal cost',
    subjectId: 's2',
    trackName: 'Economics',
    pieceId: null,
    pieceTitle: null,
    dueOn: '2026-10-11',
    open: {
      id: 'hq2',
      question: 'A bakery already makes 200 loaves a day. What does the 201st loaf cost it?',
      expected: 'Only the extra flour, energy and time for that one loaf, not a share of the oven or the rent.',
      response: 'Just the flour and the baking for that one loaf, since the oven and the rent are paid anyway.',
      correct: true,
      why: 'The answer separates the cost of one more loaf from the costs already fixed.',
      howSure: { confidence: 0.5, reasoning: null },
      hintsUsed: 1,
    },
  },
  {
    conceptId: 'h3',
    name: 'Sunk cost',
    subjectId: 's2',
    trackName: 'Economics',
    pieceId: null,
    pieceTitle: null,
    dueOn: '2026-10-10',
    open: {
      id: 'hq3',
      question: 'You paid £40 for a concert ticket and wake up ill on the night. Should the £40 decide whether you go?',
      expected: 'No. The £40 is gone whether you go or not, so only how the evening would be from here should decide.',
      response: 'Yes, otherwise the money is wasted.',
      correct: false,
      why: 'The answer counts money that is spent either way.',
      howSure: { confidence: 0.75, reasoning: null },
      hintsUsed: 1,
      revealed: true,
    },
  },
];

export function LearnReviewListSurface({ folded = false, hinted = false }: { folded?: boolean; hinted?: boolean }) {
  return (
    <ReviewList
      defaultOpen={!folded}
      reviews={hinted ? HINTED_REVIEWS : REVIEWS}
      title="Due for review"
      remember="preview.learn.fold.reviews"
      description="Ideas you answered questions on or said you know. A right answer brings the next question later; a miss brings it back tomorrow."
      showPlan
    />
  );
}

/**
 * The search box as the phone's dock button opens it (note 5f3ef44f): every
 * workspace, Home first, before anything is typed.
 */
export function GoToSurface() {
  return (
    <ToastProvider>
      <CaptureProvider>
        <AskDashProvider>
          <CommandPalette
            account="preview"
            module="jobs"
            sections={[]}
            theme={SYSTEM_THEME}
            open
            opensWith="workspaces"
            onOpenChange={() => {}}
          />
        </AskDashProvider>
      </CaptureProvider>
    </ToastProvider>
  );
}
