import 'server-only';

import { after } from 'next/server';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpendReports } from '@/lib/core/spend/record';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { keepMadeFiles } from '@/lib/you/chat-message-files';
import { sendDirect, type DirectMessenger, type DirectPorts } from '@/lib/you/group-direct-message';
import { claimTyping, replyToHandoff } from '@/lib/you/mentor-reply';
import { directChatFor } from '@/lib/you/mentor-send';

/**
 * A group's bot messaging the person in its own chat (plan #3083), bound to
 * the person's own clients so row level security keeps every read and write
 * to theirs. The reply runs through Ask Dash's tools as a one-on-one reply's
 * do; they are loaded on the first message sent, since most bursts send
 * none.
 */
export function directMessenger(client: YouSupabaseClient, core: CoreSupabaseClient, userId: string, opts: { model: string; timeZone: string }): DirectMessenger {
  const ports: DirectPorts = {
    directChat: (bot) => directChatFor(client, userId, bot),
    claim: (chatId) => claimTyping(client, userId, chatId, Date.now()),
    release: async (chatId) => {
      await client
        .from('advisor_chats')
        .update({ typing_until: null, reply_status: 'idle', reply_error: null })
        .eq('user_id', userId)
        .eq('id', chatId);
    },
    say: async (chatId, text, receipts) => {
      const { data, error } = await client
        .from('advisor_messages')
        .insert({ user_id: userId, chat_id: chatId, role: 'advisor', kind: 'reply', text, receipts })
        .select('id, created_at')
        .single();
      const row = data as { id?: unknown; created_at?: unknown } | null;
      if (error || typeof row?.id !== 'string') throw new Error(error?.message ?? 'The line was not saved.');
      return { id: row.id, createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString() };
    },
    reply: async (chatId, turn) => {
      const { peopleDashInRequest } = await import('@/lib/talk/ask-request');
      const dash = await peopleDashInRequest(userId);
      return replyToHandoff({
        client,
        userId,
        chatId,
        timeZone: opts.timeZone,
        model: opts.model,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        execute: dash.execute,
        act: dash,
        recordSpend: (operation, reports) => recordSpendReports(core, userId, { module: 'you', operation }, reports),
        keepFiles: (messageId, files) => keepMadeFiles(core, userId, messageId, files),
        handoff: turn,
      });
    },
    // Told as any unread reply is, once the group's turn has gone on (lib/you/mentor-reply-request.ts).
    announce: (chatId, bot, since) => {
      const run = async () => {
        const { announceUnreadReply } = await import('@/lib/you/mentor-reply-request');
        await announceUnreadReply(userId, chatId, bot, since);
      };
      try {
        after(run);
      } catch {
        void run().catch((error) => console.error('the group message notification was not sent', error));
      }
    },
  };
  return (asker, input) => sendDirect(ports, asker, input);
}
