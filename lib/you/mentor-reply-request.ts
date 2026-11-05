import 'server-only';

import { after } from 'next/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import { dashModelFor } from '@/lib/dash/model-choice';
import { peopleDashInRequest } from '@/lib/talk/ask-request';
import { createYouClient } from '@/lib/you/auth/server';
import { listRoster } from '@/lib/you/board-advisors';
import { loadNote } from '@/lib/you/council';
import { replyToMentor } from '@/lib/you/mentor-reply';
import { sendMentorText, type MentorSent } from '@/lib/you/mentor-send';
import { canTalkOf } from '@/lib/you/people-cards-model';
import { claimTyping } from '@/lib/you/mentor-reply';
import { mentorReplyPayload } from '@/lib/you/mentor-reply-notice';
import { notifyPerson } from '@/lib/talk/reply-state-store';

/**
 * Texting a mentor from a request (plan #2748.4): the Council's send and
 * app/api/chat/messages both come here. The message is saved and the typing
 * claimed before the request answers; the reply is written after it, with
 * `after`, as the signed-in person, so their own row level security covers
 * every read and write, and Dash's lookups and changes run as they do in Ask.
 */

export type SendInRequest = { error: string | null; saved: boolean; chatId?: string; messageId?: string; mentorKey?: string };

export async function sendMentorMessageInRequest(
  userId: string,
  input: { advisorId: string; text: string; noteId?: string | null },
): Promise<SendInRequest> {
  const client = await createYouClient();
  const mentor = (await listRoster(client, userId)).find((a) => a.id === input.advisorId);
  if (!mentor) return { error: 'That mentor is not on your council.', saved: false };
  if (input.noteId) {
    const note = await loadNote(client, userId, input.noteId);
    if (!note || note.advisorId !== input.advisorId) return { error: 'That note is not from this mentor.', saved: false };
  }
  const sent: MentorSent = await sendMentorText({
    client,
    userId,
    mentor: { id: mentor.id, name: mentor.name, canTalk: canTalkOf(mentor) },
    text: input.text,
    noteId: input.noteId ?? null,
  });
  if (!sent.saved) return { error: sent.error, saved: false };
  // A reply already being written answers this message when it finishes.
  if (sent.claimed) after(() => replyAndAnnounce(userId, sent.chatId, mentor));
  return { error: null, saved: true, chatId: sent.chatId, messageId: sent.messageId, mentorKey: mentor.key };
}

/** The reply, once the send has answered; the send already holds the typing claim. */
async function replyInRequest(userId: string, chatId: string): Promise<void> {
  const client = await createYouClient();
  try {
    const [core, settings, dash] = await Promise.all([createCoreClient(), loadAccountSettings(userId), peopleDashInRequest(userId)]);
    await replyToMentor({
      client,
      userId,
      chatId,
      timeZone: settings.timezone,
      model: await dashModelFor(core, userId),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      execute: dash.execute,
      // Ask Dash's own actions, kept as this mentor's (plan #2854.2).
      act: dash,
      recordSpend: (operation, reports) => recordSpendReports(core, userId, { module: 'you', operation }, reports),
      claimed: true,
    });
  } catch (error) {
    // replyToMentor never throws, so this is the setup before it: let go of the claim and say so.
    console.error('mentor reply could not start', error);
    await client
      .from('advisor_chats')
      .update({ typing_until: null, reply_status: 'failed', reply_error: 'The reply could not start. Send it again to try once more.' })
      .eq('user_id', userId)
      .eq('id', chatId);
  }
}

/**
 * Try again on a reply that failed (plan #2854.4): the mentor answers the
 * person's last message once more, on the server, as a send does. Nothing
 * starts while a reply is already being written; that one answers it.
 */
export async function retryMentorReplyInRequest(userId: string, chatId: string, advisorId: string): Promise<{ error: string | null }> {
  const client = await createYouClient();
  const mentor = (await listRoster(client, userId)).find((a) => a.id === advisorId);
  if (!mentor) return { error: 'That mentor is not on your council.' };
  const chat = await client
    .from('advisor_chats')
    .select('id')
    .eq('user_id', userId)
    .eq('id', chatId)
    .eq('advisor_id', advisorId)
    .maybeSingle();
  if (chat.error || !chat.data) return { error: 'That thread is not there any more.' };
  if (await claimTyping(client, userId, chatId, Date.now())) after(() => replyAndAnnounce(userId, chatId, mentor));
  return { error: null };
}

/** How long a reply may sit unread before the person is told it came: long enough for an open thread to read it. */
const READ_GRACE_MS = 8_000;

/**
 * The reply, then a notification when the person was not in the thread to
 * read it (plan #2854.4). An open thread reads a reply as it arrives
 * (app/chat/people/[key]/thread-view.tsx), so one still unread a few seconds
 * later was written while they were elsewhere. Never throws.
 */
async function replyAndAnnounce(userId: string, chatId: string, mentor: { key: string; name: string }): Promise<void> {
  const since = new Date().toISOString();
  await replyInRequest(userId, chatId);
  try {
    await new Promise((resolve) => setTimeout(resolve, READ_GRACE_MS));
    const client = await createYouClient();
    const [chat, newest] = await Promise.all([
      client
        .from('advisor_chats')
        .select('last_read_at, reply_status, reply_error')
        .eq('user_id', userId)
        .eq('id', chatId)
        .maybeSingle(),
      client
        .from('advisor_messages')
        .select('text, created_at, read_at')
        .eq('user_id', userId)
        .eq('chat_id', chatId)
        .eq('role', 'advisor')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (chat.error || newest.error) return;
    const payload = mentorReplyPayload(
      mentor,
      (chat.data ?? null) as Record<string, unknown> | null,
      (newest.data ?? null) as Record<string, unknown> | null,
    );
    if (payload) await notifyPerson(await createCoreClient(), userId, payload);
  } catch (error) {
    console.error('the mentor reply notification was not sent', error);
  }
}
