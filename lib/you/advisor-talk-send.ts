import 'server-only';

import type { DashExecutor } from '@/lib/dash/loop';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports, type SpendClient } from '@/lib/core/spend/record';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { turnBody, type TalkTurn } from '@/lib/talk/talk';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
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
 * One message to one advisor and their reply (plan #2581.6, shared with the
 * connector by #2581.7).
 *
 * The Talk tab's action and the connector's talk_to_advisor both send a
 * message the same way, and differ only in what is bound to the request: the
 * clients, the lookups the advisor reads the person's rows through, and how
 * work is run once the reply has gone. So those arrive as inputs here and
 * nothing in this file reads cookies.
 *
 * The person's words are kept before the advisor is asked, so a failed reply
 * loses nothing: the message stays in the talk and a retry asks for the reply
 * again without keeping the words twice. Once the reply is kept, what the
 * advisor should remember of the exchange is written by `later`, so the
 * reply is not held up by it.
 */

export type TalkResult = {
  /** The messages this call kept, oldest first: the person's (unless it was a retry), then the reply. */
  turns?: TalkTurn[];
  /** The talk they went into, which a first message starts. */
  chatId?: string;
  error?: string;
};

export type SentToAdvisor = TalkResult & {
  /** The advisor's name, when they were found. */
  advisorName?: string;
  /** Their profile's address, when they were found: the page to refresh. */
  href?: string;
};

export type AdvisorSend = {
  you: YouSupabaseClient;
  goals: GoalsSupabaseClient;
  /** Where spend is recorded. */
  core: SpendClient;
  userId: string;
  key: string;
  chatId: string | null;
  raw: string;
  retry?: boolean;
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  execute: DashExecutor;
  anthropicApiKey: string | undefined;
  /** Runs work once the reply has gone: `after` from next/server. */
  later: (work: () => Promise<void>) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sendToAdvisorWith(input: AdvisorSend): Promise<SentToAdvisor> {
  const { you, goals, core, userId, key, chatId, retry = false } = input;
  if (!ITEM_KEY.test(key)) return { error: 'That advisor could not be found.' };
  if (chatId !== null && !UUID.test(chatId)) return { error: 'That talk could not be found.' };
  const checked = turnBody(input.raw);
  if ('error' in checked) return { error: checked.error };

  const loaded = await loadTalkContext(you, goals, userId, key).catch(() => null);
  if (!loaded) return { error: 'That advisor could not be found.' };
  const { context } = loaded;
  const { advisor } = context;
  const href = advisorHref(advisor.key);
  const found = { advisorName: advisor.name, href };

  let chat = chatId ? await loadAdvisorChat(you, userId, advisor.id, chatId).catch(() => null) : null;
  if (chatId && !chat) return { ...found, error: 'That talk is not there any more.' };
  const earlier: AdvisorMessage[] = chat ? await loadAdvisorMessages(you, userId, chat.id) : [];

  // Try again on a reply that failed asks again for the words already kept.
  const waiting = unanswered(earlier);
  const again = retry && waiting !== null && waiting.text === checked.body;
  let mine: AdvisorMessage;
  try {
    if (!chat) chat = await startAdvisorChat(you, userId, advisor.id, chatTitle(checked.body));
    mine = again
      ? earlier[earlier.length - 1]
      : await addAdvisorMessage(you, userId, chat.id, { role: 'person', text: checked.body });
  } catch {
    return { ...found, error: 'That was not kept. Try again.' };
  }
  const kept = again ? [] : [messageTurn(mine)];
  const thread = again ? earlier : [...earlier, mine];

  const apiKey = input.anthropicApiKey;
  if (!apiKey) {
    return { ...found, chatId: chat.id, turns: kept, error: `This deployment has no ANTHROPIC_API_KEY, so ${advisor.name} cannot reply.` };
  }

  const spent: SpendReport[] = [];
  const answer = await answerAsAdvisor({
    context,
    turns: thread.map(messageTurn),
    today: input.today,
    execute: input.execute,
    anthropicApiKey: apiKey,
    chatId: chat.id,
    onSpend: (report) => spent.push(report),
  });
  await recordSpendReports(core, userId, { module: 'you', operation: 'talk-to-advisor' }, spent).catch((error) =>
    console.error('advisor talk spend was not recorded', error),
  );
  if (!answer.ok || !answer.body.trim()) {
    return {
      ...found,
      chatId: chat.id,
      turns: kept,
      error: `${advisor.name} could not reply: ${answer.ok ? 'the reply came back empty.' : answer.detail}`,
    };
  }

  let reply: AdvisorMessage;
  try {
    reply = await addAdvisorMessage(you, userId, chat.id, {
      role: 'advisor',
      text: answer.body.trim(),
      receipts: receiptsFrom(answer.citations),
    });
  } catch {
    return { ...found, chatId: chat.id, turns: kept, error: `${advisor.name} replied, but the reply was not kept. Try again.` };
  }

  const advisorId = advisor.id;
  const said = mine;
  input.later(async () => {
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

  return { ...found, chatId: chat.id, turns: [...kept, messageTurn(reply)] };
}
