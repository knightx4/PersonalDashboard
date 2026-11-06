import 'server-only';

import { after } from 'next/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import { dashModelFor } from '@/lib/dash/model-choice';
import { createYouClient } from '@/lib/you/auth/server';
import { cleanMessage } from '@/lib/you/council-model';
import { BURST_REQUEST_MS, MAX_REPLY_ROUNDS, runGroupBurst } from '@/lib/you/group-burst';
import { loadGroup } from '@/lib/you/group-chats';
import { lookUpPlaces } from '@/lib/you/places-lookup';
import { claimTyping } from '@/lib/you/mentor-reply';

/**
 * Writing in a group from a request (plan #2879.1.2): POST
 * /api/chat/groups/[id]/messages comes here. The message is saved and the
 * lease claimed before the request answers; the burst runs after it, with
 * `after`, as the signed-in person. A burst that runs short of time posts
 * to /api/chat/groups/[id]/burst with the person's own cookie, which picks
 * the lease up and carries on.
 */

/** Where a chained request is sent, and as whom. */
export type ChainTo = { origin: string; cookie: string | null };

export type GroupSendResult = { error: string | null; saved: boolean; messageId?: string };

export async function sendGroupMessageInRequest(userId: string, input: { chatId: string; text: string }, chainTo: ChainTo): Promise<GroupSendResult> {
  const client = await createYouClient();
  const clean = cleanMessage(input.text);
  if (!clean.ok) return { error: clean.error, saved: false };
  const group = await loadGroup(client, userId, input.chatId);
  if (!group) return { error: 'That group is not there any more.', saved: false };
  if (group.members.length === 0) return { error: 'Add a bot to the group first.', saved: false };
  const now = Date.now();
  const message = await client
    .from('advisor_messages')
    .insert({ user_id: userId, chat_id: input.chatId, role: 'person', text: clean.text })
    .select('id')
    .single();
  if (message.error || typeof message.data?.id !== 'string') {
    throw new Error(`Your message was not saved: ${message.error?.message ?? 'no row came back'}`);
  }
  // A burst already running sees this message after the turn in hand and plans again.
  if (await claimTyping(client, userId, input.chatId, now)) after(() => burstInRequest(userId, input.chatId, { claimed: true, round: undefined }, chainTo));
  return { error: null, saved: true, messageId: message.data.id };
}

/** A chained request carrying a burst on; the request before it still holds the lease. */
export async function continueBurstInRequest(userId: string, chatId: string, round: number, chainTo: ChainTo): Promise<void> {
  const safeRound = Math.max(0, Math.min(MAX_REPLY_ROUNDS + 1, Math.floor(round)));
  after(() => burstInRequest(userId, chatId, { claimed: true, round: safeRound }, chainTo));
}

async function burstInRequest(userId: string, chatId: string, from: { claimed: boolean; round: number | undefined }, chainTo: ChainTo): Promise<void> {
  const client = await createYouClient();
  try {
    const core = await createCoreClient();
    await runGroupBurst({
      client,
      userId,
      chatId,
      model: await dashModelFor(core, userId),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      recordSpend: (operation, reports) => recordSpendReports(core, userId, { module: 'you', operation }, reports),
      // Places near home for any speaker, under the app's daily cap (plan #2987.3).
      findPlaces: (search) => lookUpPlaces({ you: client, core, userId }, search),
      claimed: from.claimed,
      round: from.round,
      deadline: Date.now() + BURST_REQUEST_MS,
      chain: async ({ round }) => {
        const res = await fetch(new URL(`/api/chat/groups/${chatId}/burst`, chainTo.origin), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(chainTo.cookie ? { cookie: chainTo.cookie } : {}) },
          body: JSON.stringify({ round }),
        });
        if (!res.ok) throw new Error(`The group could not carry on: ${res.status}`);
      },
    });
  } catch (error) {
    // runGroupBurst never throws, so this is the setup before it, or a chain that did not start.
    console.error('group burst could not run', error);
    await client
      .from('advisor_chats')
      .update({ typing_until: null, reply_status: 'failed', reply_error: 'The group could not reply. Send it again to try once more.' })
      .eq('user_id', userId)
      .eq('id', chatId);
    await client.from('advisor_chat_members').update({ typing_until: null }).eq('user_id', userId).eq('chat_id', chatId);
  }
}
