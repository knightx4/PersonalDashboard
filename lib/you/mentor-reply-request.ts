import 'server-only';

import { after } from 'next/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import { dashModelFor } from '@/lib/dash/model-choice';
import { threadDashInRequest } from '@/lib/talk/ask-request';
import { createYouClient } from '@/lib/you/auth/server';
import { listRoster } from '@/lib/you/board-advisors';
import { loadNote } from '@/lib/you/council';
import { replyToMentor } from '@/lib/you/mentor-reply';
import { sendMentorText, type MentorSent } from '@/lib/you/mentor-send';
import { canTalkOf } from '@/lib/you/people-cards-model';

/**
 * Texting a mentor from a request (plan #2748.4): the Council's send and
 * app/api/chat/messages both come here. The message is saved and the typing
 * claimed before the request answers; the reply is written after it, with
 * `after`, as the signed-in person, so their own row level security covers
 * every read and write and Dash's lookups run as they do in Ask.
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
  if (sent.claimed) after(() => replyInRequest(userId, sent.chatId));
  return { error: null, saved: true, chatId: sent.chatId, messageId: sent.messageId, mentorKey: mentor.key };
}

/** The reply, once the send has answered; the send already holds the typing claim. */
async function replyInRequest(userId: string, chatId: string): Promise<void> {
  const client = await createYouClient();
  try {
    const [core, settings, dash] = await Promise.all([createCoreClient(), loadAccountSettings(userId), threadDashInRequest(userId)]);
    await replyToMentor({
      client,
      userId,
      chatId,
      timeZone: settings.timezone,
      model: await dashModelFor(core, userId),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      execute: dash.execute,
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
