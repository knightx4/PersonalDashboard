import 'server-only';

import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import { dashModelFor } from '@/lib/dash/model-choice';
import { peopleDashInRequest } from '@/lib/talk/ask-request';
import { endBotHandoff, loadBotHandoff, pickUpBotHandoff } from '@/lib/talk/bot-handoffs';
import { createYouClient } from '@/lib/you/auth/server';
import { listRoster } from '@/lib/you/board-advisors';
import { keepMadeFiles } from '@/lib/you/chat-message-files';
import { answerBotHandoff, type HandoffBot, type HandoffReplyPorts, type HandoffReplyResult } from '@/lib/you/bot-handoff-reply';
import { claimTyping, replyToHandoff } from '@/lib/you/mentor-reply';
import { announceUnreadReply } from '@/lib/you/mentor-reply-request';
import { directChatFor } from '@/lib/you/mentor-send';
import { canTalkOf } from '@/lib/you/people-cards-model';

/**
 * The receiving bot taking up a hand-off (plan #3003.3), as the signed-in
 * person, so their own row level security covers every read and write, and
 * the bot's changes run through Ask Dash's tools as a reply's do. Started
 * with `after` once the sending bot has kept the row
 * (lib/talk/hand-to-bot-store.ts).
 */
export async function answerBotHandoffInRequest(userId: string, handoffId: string): Promise<HandoffReplyResult> {
  const [client, core, settings, dash] = await Promise.all([
    createYouClient(),
    createCoreClient(),
    loadAccountSettings(userId),
    peopleDashInRequest(userId),
  ]);
  const model = await dashModelFor(core, userId);

  let roster: HandoffBot[] | null = null;
  const bots = async () =>
    (roster ??= (await listRoster(client, userId)).map((a) => ({ id: a.id, key: a.key, name: a.name, canTalk: canTalkOf(a) })));

  const ports: HandoffReplyPorts = {
    load: (id) => loadBotHandoff(core, userId, id),
    bot: async (id) => (await bots()).find((b) => b.id === id) ?? null,
    directChat: (bot) => directChatFor(client, userId, bot),
    claim: (chatId) => claimTyping(client, userId, chatId, Date.now()),
    release: async (chatId) => {
      await client
        .from('advisor_chats')
        .update({ typing_until: null, reply_status: 'idle', reply_error: null })
        .eq('user_id', userId)
        .eq('id', chatId);
    },
    pickUp: (id) => pickUpBotHandoff(core, userId, id),
    say: async (chatId, text) => {
      const { data, error } = await client
        .from('advisor_messages')
        .insert({ user_id: userId, chat_id: chatId, role: 'advisor', kind: 'reply', text })
        .select('id, created_at')
        .single();
      const row = data as { id?: unknown; created_at?: unknown } | null;
      if (error || typeof row?.id !== 'string') throw new Error(error?.message ?? 'The line was not saved.');
      return { id: row.id, createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString() };
    },
    reply: (chatId, handoff) =>
      replyToHandoff({
        client,
        userId,
        chatId,
        timeZone: settings.timezone,
        model,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        execute: dash.execute,
        // Ask Dash's own actions, kept as this bot's under its hand-off line (plan #2854.2).
        act: dash,
        recordSpend: (operation, reports) => recordSpendReports(core, userId, { module: 'you', operation }, reports),
        // What the bot's code made, kept under its reply (plan #3050.3.1).
        keepFiles: (messageId, files) => keepMadeFiles(core, userId, messageId, files),
        handoff,
      }),
    end: async (id, end) => {
      const ended = await endBotHandoff(core, userId, id, end);
      if (!ended.ok) throw new Error(ended.error);
    },
    announce: (chatId, bot, since) => announceUnreadReply(userId, chatId, bot, since),
  };
  return answerBotHandoff(ports, handoffId);
}
