'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { threadDashInRequest } from '@/lib/talk/ask-request';
import { createYouClient } from '@/lib/you/auth/server';
import { ITEM_KEY } from '@/lib/you/board';
import { advisorHref } from '@/lib/you/board-profile';
import { sendToAdvisorWith, type TalkResult } from '@/lib/you/advisor-talk-send';
import { retireAdvisorMemory } from '@/lib/you/advisor-talk-store';

/**
 * The Talk tab's actions (plan #2581.6): send a message to one advisor and
 * keep their reply, and forget a memory. The send itself is
 * lib/you/advisor-talk-send.ts, which the connector's talk_to_advisor shares;
 * this binds it to the signed-in person's clients and lookups.
 */

export type { TalkResult };

const uuid = z.string().uuid();

// latency: pending -- the thread shows the advisor typing until the reply lands
export async function sendToAdvisor(
  key: string,
  chatId: string | null,
  raw: string,
  retry = false,
): Promise<TalkResult> {
  const user = await requireUser();
  const [you, goals, core, dash] = await Promise.all([
    createYouClient(),
    createGoalsClient(),
    createCoreClient(),
    threadDashInRequest(user.id),
  ]);
  const sent = await sendToAdvisorWith({
    you,
    goals,
    core,
    userId: user.id,
    key,
    chatId,
    raw,
    retry,
    today: dash.today,
    execute: dash.execute,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    later: (work) => after(work),
  });
  if (sent.href) revalidatePath(sent.href);
  return { turns: sent.turns, chatId: sent.chatId, error: sent.error };
}

/** Stop an advisor reading one memory: it is kept, but no talk or meeting is told it again. */
// latency: optimistic -- the memory leaves the list at once
export async function forgetAdvisorMemory(key: string, id: string): Promise<{ error: string | null }> {
  if (!ITEM_KEY.test(key) || !uuid.safeParse(id).success) return { error: 'That memory could not be found.' };
  const user = await requireUser();
  const you = await createYouClient();
  try {
    const forgotten = await retireAdvisorMemory(you, user.id, [id]);
    if (forgotten === 0) return { error: 'That memory could not be found.' };
  } catch {
    return { error: 'That was not forgotten. Try again.' };
  }
  revalidatePath(advisorHref(key));
  return { error: null };
}
