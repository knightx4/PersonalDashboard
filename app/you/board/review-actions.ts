'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { answerReview, OUTCOMES, REVIEW_DAYS, type Outcome, type ReviewAt } from '@/lib/you/board-reviews';
import { answerTripwire } from '@/lib/you/board-tripwires';

/**
 * The person's answer to the board checking back on a decision (plan
 * #2561.8): whether it went well, mixed or badly. Saving it grades each
 * advisor's final pick on the question, for the scorecard.
 */

const input = z.object({
  questionId: z.string().uuid(),
  at: z.union(REVIEW_DAYS.map((d) => z.literal(d)) as [z.ZodLiteral<30>, z.ZodLiteral<90>]),
  outcome: z.enum(OUTCOMES),
});

// latency: pending
export async function answerBoardReview(
  questionId: string,
  at: ReviewAt,
  outcome: Outcome,
): Promise<{ error: string | null }> {
  const parsed = input.safeParse({ questionId, at, outcome });
  if (!parsed.success) return { error: 'That is not a check-back the board wrote.' };
  try {
    const user = await requireUser();
    const client = await createYouClient();
    const result = await answerReview(client, user.id, questionId, at, outcome);
    if (result === 'missing') return { error: 'That decision is no longer on your board.' };
    if (result === 'changed') return { error: 'This decision changed while you were looking. Read the page again.' };
    revalidatePath('/you/board');
    revalidatePath('/you/board/[id]', 'page');
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your answer was not saved. Try again.' };
  }
}

const tripwireInput = z.object({ questionId: z.string().uuid(), tripped: z.boolean() });

/**
 * The person settling a tripwire that fell due (plan #2581.10): it happened,
 * which reopens the decision for the next meeting, or it did not.
 */
// latency: pending
export async function answerBoardTripwire(
  questionId: string,
  tripped: boolean,
): Promise<{ error: string | null }> {
  const parsed = tripwireInput.safeParse({ questionId, tripped });
  if (!parsed.success) return { error: 'That is not a tripwire the board set.' };
  try {
    const user = await requireUser();
    const client = await createYouClient();
    const result = await answerTripwire(client, user.id, questionId, tripped);
    if (result === 'missing') return { error: 'That decision is no longer on your board.' };
    if (result === 'changed') return { error: 'The board already checked this tripwire. Read the page again.' };
    revalidatePath('/you/board');
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your answer was not saved. Try again.' };
  }
}
