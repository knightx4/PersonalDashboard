'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { goalsRoutine } from '@/lib/feedback/routine';
import { createYouClient } from '@/lib/you/auth/server';
import {
  saveAnswer,
  saveNow,
  saveVerdict,
  VERDICTS,
  type InsightVerdict,
  type NowNote,
  type Verdict,
} from '@/lib/you/insights';
import { startInsightRun as startRun } from '@/lib/you/insights-start';

/** What a mark sends back: the verdict as saved, or why it was not. */
export type MarkResult = { error: string | null; saved?: InsightVerdict };

/**
 * Mark one insight right, not quite or wrong, with an optional line of why
 * (plan #2413.5). Marking it again replaces the mark.
 */
// latency: pending
export async function markInsight(insightId: string, verdict: Verdict, note?: string | null): Promise<MarkResult> {
  if (!z.string().uuid().safeParse(insightId).success) return { error: 'That is not an insight.' };
  if (!VERDICTS.includes(verdict)) return { error: 'That is not a mark.' };
  const user = await requireUser();
  try {
    const saved = await saveVerdict(await createYouClient(), user.id, insightId, verdict, note);
    revalidatePath('/you/insights');
    return { error: null, saved };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your mark was not saved. Try again.' };
  }
}

/**
 * What they wrote back to the question a card ends with (you 0018). The next
 * run reads it before anything else. A blank answer clears it.
 */
// latency: pending
export async function answerInsight(
  insightId: string,
  answer: string,
): Promise<{ error: string | null; saved?: { answer: string | null; answeredAt: string | null } }> {
  if (!z.string().uuid().safeParse(insightId).success) return { error: 'That is not an insight.' };
  const user = await requireUser();
  try {
    const saved = await saveAnswer(await createYouClient(), user.id, insightId, answer);
    revalidatePath('/you/insights');
    return { error: null, saved };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your answer was not saved. Try again.' };
  }
}

/** Their note on where they are now, which every run reads first (you 0018). */
// latency: pending
export async function saveNowNote(body: string): Promise<{ error: string | null; saved?: NowNote }> {
  const user = await requireUser();
  try {
    const saved = await saveNow(await createYouClient(), user.id, body);
    revalidatePath('/you/insights');
    return { error: null, saved };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your note was not saved. Try again.' };
  }
}

/**
 * Look again: a whole session on the goals routine that follows the insights
 * skill, reading every private note and sending readers across the person's
 * history (.claude/skills/insights/SKILL.md). It spends their Claude plan, so
 * besides the monthly tick it only starts here, when they press it.
 */
// latency: pending
export async function startInsightRun(): Promise<{ error: string | null }> {
  const user = await requireUser();
  const result = await startRun({
    client: await createYouClient(),
    userId: user.id,
    reason: 'look_again',
    routine: goalsRoutine(),
  });
  revalidatePath('/you/insights');
  return { error: result.started ? null : result.error };
}
