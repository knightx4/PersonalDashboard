import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadMoveState } from '@/lib/learn/levels/move-store';
import { MoveReviewView } from './review-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'From the claims graph' };
/** One subject's move is one call and the topics it drafts. */
export const maxDuration = 300;

/**
 * Moving the claims graph onto topics (plan #2138.4): the Move press, how
 * far it has got, and what it left for the person to answer.
 */
export default async function MoveReviewPage() {
  await requireUser();
  const learn = await createLearnClient();
  const state = await loadMoveState(learn);
  return <MoveReviewView state={state} />;
}
