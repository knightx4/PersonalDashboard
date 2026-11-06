import 'server-only';

import { after } from 'next/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import { dashModelFor } from '@/lib/dash/model-choice';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { cleanMessage } from '@/lib/you/council-model';
import { BURST_REQUEST_MS, MAX_REPLY_ROUNDS, runGroupBurst } from '@/lib/you/group-burst';
import { loadGroup } from '@/lib/you/group-chats';
import { lookUpPlaces } from '@/lib/you/places-lookup';
import { claimTyping } from '@/lib/you/mentor-reply';
import { groupStillOwed } from '@/lib/you/reply-turn';
import { isOwner } from '@/lib/dev/owner';
import { botPageStarter } from '@/lib/you/bot-pages-store';

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

/**
 * Ask a group to answer the person's newest text again (plan #2988.3): Try
 * again on a burst that failed, or the thread's safety net once a text has
 * waited a minute with nothing typing (`stalled`). It claims the lease and
 * runs the burst after the action answers, as a send does; nothing starts
 * while a burst already holds the lease, since that one reads the text. The
 * safety net also starts nothing when the text is no longer the newest, or
 * a burst already ended quietly after it.
 */
export async function retryGroupBurstInRequest(
  userId: string,
  chatId: string,
  chainTo: ChainTo,
  options: { stalled?: boolean } = {},
): Promise<{ error: string | null }> {
  const client = await createYouClient();
  const group = await loadGroup(client, userId, chatId);
  if (!group) return { error: 'That group is not there any more.' };
  if (group.members.length === 0) return { error: 'Add a bot to the group first.' };
  if (options.stalled) {
    const [chat, newest] = await Promise.all([
      client.from('advisor_chats').select('reply_status, reply_requested_at').eq('user_id', userId).eq('id', chatId).maybeSingle(),
      client
        .from('advisor_messages')
        .select('role, created_at')
        .eq('user_id', userId)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (chat.error || newest.error) return { error: 'The group could not reply. Try again.' };
    const last = (newest.data ?? null) as { role?: unknown; created_at?: unknown } | null;
    if (last?.role !== 'person' || typeof last.created_at !== 'string') return { error: null };
    const row = (chat.data ?? {}) as { reply_status?: unknown; reply_requested_at?: unknown };
    const owed = groupStillOwed(
      {
        replyStatus: typeof row.reply_status === 'string' ? row.reply_status : null,
        requestedAt: typeof row.reply_requested_at === 'string' ? row.reply_requested_at : null,
      },
      last.created_at,
    );
    if (!owed) return { error: null };
  }
  if (await claimTyping(client, userId, chatId, Date.now())) after(() => burstInRequest(userId, chatId, { claimed: true, round: undefined }, chainTo));
  return { error: null };
}

/** A chained request carrying a burst on; the request before it still holds the lease. */
export async function continueBurstInRequest(userId: string, chatId: string, round: number, chainTo: ChainTo): Promise<void> {
  const safeRound = Math.max(0, Math.min(MAX_REPLY_ROUNDS + 1, Math.floor(round)));
  after(() => burstInRequest(userId, chatId, { claimed: true, round: safeRound }, chainTo));
}

async function burstInRequest(userId: string, chatId: string, from: { claimed: boolean; round: number | undefined }, chainTo: ChainTo): Promise<void> {
  const client = await createYouClient();
  try {
    const [core, settings, owner] = await Promise.all([createCoreClient(), loadAccountSettings(userId), isOwner()]);
    await runGroupBurst({
      client,
      userId,
      chatId,
      timeZone: settings.timezone,
      model: await dashModelFor(core, userId),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      recordSpend: (operation, reports) => recordSpendReports(core, userId, { module: 'you', operation }, reports),
      // Places near home for any speaker, under the app's daily cap (plan #2987.3).
      findPlaces: (search) => lookUpPlaces({ you: client, core, userId }, search),
      // Pages made in a session (plan #2997), for the owner, as in a direct chat.
      makePage: owner ? (botPageStarter(core, userId) ?? undefined) : undefined,
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
      .update({ typing_until: null, reply_status: 'failed', reply_error: 'The group could not reply.' })
      .eq('user_id', userId)
      .eq('id', chatId);
    await client.from('advisor_chat_members').update({ typing_until: null }).eq('user_id', userId).eq('chat_id', chatId);
  }
}
