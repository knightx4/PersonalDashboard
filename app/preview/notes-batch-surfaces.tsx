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
];

export function LearnReviewListSurface({ folded = false }: { folded?: boolean }) {
  return (
    <ReviewList
      defaultOpen={!folded}
      reviews={REVIEWS}
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
