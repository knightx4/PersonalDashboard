'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { goalsRoutine } from '@/lib/feedback/routine';
import { createYouClient } from '@/lib/you/auth/server';
import { BATCH_ROWS, CHAT_BODY_MAX, importChatLines } from '@/lib/you/claude-chats';
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

const chatBatchSchema = z
  .array(
    z.object({
      messageId: z.string().min(1).max(100),
      conversationId: z.string().max(100).nullable(),
      conversationTitle: z.string().max(300).nullable(),
      saidAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
      body: z.string().min(1).max(CHAT_BODY_MAX),
    }),
  )
  .max(BATCH_ROWS);

/**
 * One batch of their own messages from the claude.ai export, read in their
 * browser (lib/you/claude-chats.ts). A message already imported is skipped,
 * so importing a newer export adds only what is new.
 */
// latency: pending
export async function importClaudeChats(batch: unknown): Promise<{ error: string | null; added?: number }> {
  const parsed = chatBatchSchema.safeParse(batch);
  if (!parsed.success) return { error: 'Some of these messages could not be read, so none of this batch was saved.' };
  const user = await requireUser();
  try {
    const added = await importChatLines(await createYouClient(), user.id, parsed.data);
    return { error: null, added };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your chats were not saved. Try again.' };
  }
}

/** Called once the last batch is in, so the counts on the tab are new. */
// latency: pending
export async function refreshInsights(): Promise<void> {
  await requireUser();
  revalidatePath('/you/insights');
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
