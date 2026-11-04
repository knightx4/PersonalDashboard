'use server';

import { requireUser } from '@/lib/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { markMentorRead } from '@/lib/you/council';
import { loadThreadPage, markThreadRead, type ThreadPage } from '@/lib/you/chat-threads';

/**
 * The People tab's two presses that are not a send (plan #2748.6): reading
 * the page of a thread before the oldest one shown, and reading a thread,
 * which having it open does. A send goes through POST /api/chat/messages.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// latency: pending
export async function olderMessages(chatId: string, before: string): Promise<ThreadPage | { error: string }> {
  const user = await requireUser();
  if (!UUID.test(chatId) || !Number.isFinite(Date.parse(before))) return { error: 'Those messages cannot be read.' };
  try {
    return await loadThreadPage(await createYouClient(), user.id, chatId, before);
  } catch (error) {
    console.error('older messages not read', error);
    return { error: 'Earlier messages could not be read.' };
  }
}

// latency: instant
export async function readThread(chatId: string, advisorId: string): Promise<void> {
  const user = await requireUser();
  if (!UUID.test(chatId) || !UUID.test(advisorId)) return;
  const client = await createYouClient();
  try {
    // The mentor's notes are texts in the thread now (plan #2748.7), so reading it reads them too.
    await Promise.all([markThreadRead(client, user.id, chatId), markMentorRead(client, user.id, advisorId)]);
  } catch (error) {
    console.error('thread not marked read', error);
  }
}
