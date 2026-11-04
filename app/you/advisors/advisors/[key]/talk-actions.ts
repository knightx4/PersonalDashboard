'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { threadDashInRequest } from '@/lib/talk/ask-request';
import { turnBody, type TalkTurn } from '@/lib/talk/talk';
import { createYouClient } from '@/lib/you/auth/server';
import { ITEM_KEY } from '@/lib/you/board';
import { advisorHref } from '@/lib/you/board-profile';
import { chatTitle, messageTurn, receiptsFrom, unanswered, type AdvisorMessage } from '@/lib/you/advisor-talk';
import { answerAsAdvisor, rememberExchange } from '@/lib/you/advisor-talk-run';
import {
  addAdvisorMessage,
  loadAdvisorChat,
  loadAdvisorMemory,
  loadAdvisorMessages,
  loadTalkContext,
  retireAdvisorMemory,
  saveAdvisorMemory,
  startAdvisorChat,
} from '@/lib/you/advisor-talk-store';

/**
 * The Talk tab's actions (plan #2581.6): send a message to one advisor and
 * keep their reply, and forget a memory.
 *
 * The person's words are kept before the advisor is asked, so a failed reply
 * loses nothing: the message stays in the talk and Try again asks for the
 * reply again without keeping the words twice. Once the reply is kept, what
 * the advisor should remember of the exchange is written after the response
 * has gone (`after`), so the reply is not held up by it.
 */

export type TalkResult = {
  /** The messages this call kept, oldest first: the person's (unless it was a retry), then the reply. */
  turns?: TalkTurn[];
  /** The talk they went into, which a first message starts. */
  chatId?: string;
  error?: string;
};

const uuid = z.string().uuid();

// latency: pending -- the thread shows the advisor typing until the reply lands
export async function sendToAdvisor(
  key: string,
  chatId: string | null,
  raw: string,
  retry = false,
): Promise<TalkResult> {
  if (!ITEM_KEY.test(key)) return { error: 'That advisor could not be found.' };
  if (chatId !== null && !uuid.safeParse(chatId).success) return { error: 'That talk could not be found.' };
  const checked = turnBody(raw);
  if ('error' in checked) return { error: checked.error };

  const user = await requireUser();
  const [you, goals, core] = await Promise.all([createYouClient(), createGoalsClient(), createCoreClient()]);
  const loaded = await loadTalkContext(you, goals, user.id, key).catch(() => null);
  if (!loaded) return { error: 'That advisor could not be found.' };
  const { context } = loaded;
  const { advisor } = context;

  let chat = chatId ? await loadAdvisorChat(you, user.id, advisor.id, chatId).catch(() => null) : null;
  if (chatId && !chat) return { error: 'That talk is not there any more.' };
  const earlier: AdvisorMessage[] = chat ? await loadAdvisorMessages(you, user.id, chat.id) : [];

  // Try again on a reply that failed asks again for the words already kept.
  const waiting = unanswered(earlier);
  const again = retry && waiting !== null && waiting.text === checked.body;
  let mine: AdvisorMessage;
  try {
    if (!chat) chat = await startAdvisorChat(you, user.id, advisor.id, chatTitle(checked.body));
    mine = again
      ? earlier[earlier.length - 1]
      : await addAdvisorMessage(you, user.id, chat.id, { role: 'person', text: checked.body });
  } catch {
    return { error: 'That was not kept. Try again.' };
  }
  const kept = again ? [] : [messageTurn(mine)];
  const thread = again ? earlier : [...earlier, mine];
  const href = advisorHref(advisor.key);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { chatId: chat.id, turns: kept, error: `This deployment has no ANTHROPIC_API_KEY, so ${advisor.name} cannot reply.` };
  }

  const dash = await threadDashInRequest(user.id);
  const spent: SpendReport[] = [];
  const answer = await answerAsAdvisor({
    context,
    turns: thread.map(messageTurn),
    today: dash.today,
    execute: dash.execute,
    anthropicApiKey: apiKey,
    chatId: chat.id,
    onSpend: (report) => spent.push(report),
  });
  await recordSpendReports(core, user.id, { module: 'you', operation: 'talk-to-advisor' }, spent).catch((error) =>
    console.error('advisor talk spend was not recorded', error),
  );
  if (!answer.ok || !answer.body.trim()) {
    revalidatePath(href);
    return {
      chatId: chat.id,
      turns: kept,
      error: `${advisor.name} could not reply: ${answer.ok ? 'the reply came back empty.' : answer.detail}`,
    };
  }

  let reply: AdvisorMessage;
  try {
    reply = await addAdvisorMessage(you, user.id, chat.id, {
      role: 'advisor',
      text: answer.body.trim(),
      receipts: receiptsFrom(answer.citations),
    });
  } catch {
    revalidatePath(href);
    return { chatId: chat.id, turns: kept, error: `${advisor.name} replied, but the reply was not kept. Try again.` };
  }

  const userId = user.id;
  const advisorId = advisor.id;
  const said = mine;
  after(async () => {
    const remembered: SpendReport[] = [];
    try {
      const memory = await loadAdvisorMemory(you, userId, advisorId);
      const learnt = await rememberExchange({
        advisorName: advisor.name,
        memory,
        person: said.text,
        advisor: reply.text,
        anthropicApiKey: apiKey,
        onSpend: (report) => remembered.push(report),
      });
      await saveAdvisorMemory(you, userId, advisorId, learnt.remember, said.id);
      await retireAdvisorMemory(you, userId, learnt.retire, advisorId);
    } catch (error) {
      console.error('advisor memory was not kept', error);
    } finally {
      await recordSpendReports(core, userId, { module: 'you', operation: 'remember-advisor-talk' }, remembered).catch(
        (error) => console.error('advisor memory spend was not recorded', error),
      );
    }
  });

  revalidatePath(href);
  return { chatId: chat.id, turns: [...kept, messageTurn(reply)] };
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
