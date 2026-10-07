import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadPiecePage } from '@/lib/learn/lessons/piece-store';
import { loadPieceStanding, loadPracticeView } from '@/lib/learn/lessons/practice-store';
import { REVIEWS_AT_PIECE_START, type DueReview } from '@/lib/learn/lessons/review';
import { loadDueReviews } from '@/lib/learn/lessons/review-store';
import { PiecePageView } from './piece-page-view';

export const dynamic = 'force-dynamic';

/**
 * Writing a missing lesson or the practice task is one Sonnet call of up to a
 * minute, and the page's actions inherit this ceiling.
 */
export const maxDuration = 120;

/**
 * One piece of a learning goal's plan (plan #1141, LEARN-LESSONS-SPEC "A
 * piece is worked through on its own page"): its lessons in order, then its
 * practice task (plan #1142), then its check. Any piece opens, in any order;
 * nothing is locked by the suggested one. The piece is passed only when a
 * hand-in for its practice meets every point and its check is answered right.
 *
 * Up to two ideas from this plan's passed pieces that are due for review open
 * the page (plan #1145), leaving out this piece's own.
 */
export default async function PiecePage({ params }: { params: Promise<{ id: string; piece: string }> }) {
  const { id, piece: pieceId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(pieceId).success) notFound();

  const user = await requireUser();
  const learn = await createLearnClient();
  const [page, practice, standing] = await Promise.all([
    loadPiecePage(learn, user.id, id, pieceId),
    loadPracticeView(learn, user.id, pieceId),
    loadPieceStanding(learn, user.id, pieceId),
  ]);
  if (!page) notFound();
  // A review list that cannot be read leaves the piece as it was.
  const reviews = await loadDueReviews(learn, user.id, {
    limit: REVIEWS_AT_PIECE_START,
    subjectId: id,
    skip: page.ideas.map((idea) => idea.conceptId),
  }).catch((): DueReview[] => []);

  return <PiecePageView page={page} practice={practice} standing={standing} reviews={reviews} />;
}
