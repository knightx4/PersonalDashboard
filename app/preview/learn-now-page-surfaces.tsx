import { NowHeader } from '@/app/learn/now/header';
import { NowSkeleton, NowView, type PreparingRow } from '@/app/learn/now/now-view';
import { waitingEmpty, waitingLines, type WaitingCounts } from '@/lib/learn/feed/waiting';
import type { StartLine } from '@/lib/learn/next/session';
import { TodaysPieceSurface } from './todays-piece-surfaces';

/**
 * Now as it opens (plan #2313.1): today's piece, the practice press, and the
 * rail with what is waiting and the subjects still being prepared. Its hidden
 * parts: no piece today (the practice press leads and nothing is preparing),
 * no prepared subject yet (the empty state offers adding one), and the page
 * loading.
 */

const PREPARING: PreparingRow[] = [
  {
    subjectId: '5e000000-0000-4000-8000-000000000031',
    name: 'Comparative constitutional law and the separation of powers',
    line: 'Preparing · step 4 of 8, Lay out the territory',
  },
  {
    subjectId: '5e000000-0000-4000-8000-000000000032',
    name: 'Bayesian statistics',
    line: 'Preparing · starting in a moment',
  },
  {
    subjectId: '5e000000-0000-4000-8000-000000000033',
    name: 'Roman history',
    line: 'Preparation stopped · step 2 of 8, Find syllabi and other structure documents',
  },
];

const WAITING: WaitingCounts = { inbox: 4, reviews: 3, readings: 1, cards: 12 };
const NOTHING: WaitingCounts = { inbox: 0, reviews: 0, readings: 0, cards: 0 };

const header = <NowHeader practice={false} />;

const START: StartLine = {
  kind: 'lesson',
  word: 'Lesson',
  title: 'How a supplier’s bargaining power squeezes the margins of everyone who buys from it',
  place: 'Corporate strategy · Where an industry’s profits go',
};

/** A prepared subject's piece leads, with practice under it and three subjects still preparing beside. */
export function NowPageSurface() {
  return (
    <NowView
      header={header}
      start={START}
      today={<TodaysPieceSurface />}
      hasPiece
      pieceTitle="Retention: who stays and what they pay"
      prepared={3}
      preparing={PREPARING}
      waiting={waitingLines(WAITING)}
      waitingEmpty={waitingEmpty(WAITING)}
    />
  );
}

const QUESTION: StartLine = { kind: 'question', word: 'Question', title: 'Competitive advantage', place: 'Level 4' };

/** No piece today and nothing preparing: Start opens on a question and practice folds under it. */
export function NowPagePracticeSurface() {
  return (
    <NowView
      header={header}
      start={QUESTION}
      today={null}
      hasPiece={false}
      prepared={1}
      preparing={[]}
      waiting={waitingLines(NOTHING)}
      waitingEmpty={waitingEmpty(NOTHING)}
    />
  );
}

/** No subject prepared yet, with one being prepared: the empty state offers adding a subject. */
export function NowPageEmptySurface() {
  return (
    <NowView
      header={header}
      start={null}
      today={null}
      hasPiece={false}
      prepared={0}
      preparing={PREPARING.slice(1, 2)}
      waiting={waitingLines(NOTHING)}
      waitingEmpty={waitingEmpty(NOTHING)}
    />
  );
}

/** The page loading. */
export function NowPageLoadingSurface() {
  return <NowSkeleton />;
}

/** A prepared subject with nothing left to learn, or a read that failed: the Start card says nothing is waiting. */
export function NowPageQuietSurface() {
  return (
    <NowView
      header={header}
      start={null}
      today={null}
      hasPiece={false}
      prepared={2}
      preparing={[]}
      waiting={waitingLines(NOTHING)}
      waitingEmpty={waitingEmpty(NOTHING)}
    />
  );
}
