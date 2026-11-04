'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { createYouClient } from '@/lib/you/auth/server';
import { forgetMemory, markMentorRead } from '@/lib/you/council';
import { loadThreadPage, markThreadRead, type ThreadPage } from '@/lib/you/chat-threads';
import { retryMentorReplyInRequest } from '@/lib/you/mentor-reply-request';
import { loadPeopleChanges, type DashChange } from '@/lib/talk/changes';
import {
  addPerson,
  ASK_MAX,
  briefOf,
  cleanPersonForm,
  correctMemory,
  draftPersona,
  draftReady,
  MEMORY_LINE_MAX,
  PERSON_NAME_MAX,
  PERSONA_MAX,
  savePerson,
  WHO_MAX,
  type CardAuthor,
  type PersonBrief,
} from '@/lib/you/people-cards';

/**
 * The People tab's presses that are not a send (plan #2748.6): reading the
 * page of a thread before the oldest one shown, and reading a thread, which
 * having it open does. A send goes through POST /api/chat/messages. Then
 * adding and editing a person and what they remember (plan #2748.11).
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

/**
 * The changes someone on People made or proposed in one thread (plan
 * #2854.2.1), read again when their reply comes in, so its cards show
 * without a reload. Null when they could not be read; the thread keeps what
 * it has.
 */
// latency: instant
export async function threadChanges(chatId: string): Promise<DashChange[] | null> {
  await requireUser();
  if (!UUID.test(chatId)) return null;
  try {
    return await loadPeopleChanges(await createCoreClient(), chatId);
  } catch (error) {
    console.error('thread changes not read', error);
    return null;
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

/** Try again on a mentor's reply that failed (plan #2854.4); the reply comes over Realtime as a sent one does. */
// latency: instant
export async function retryReply(chatId: string, advisorId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!UUID.test(chatId) || !UUID.test(advisorId)) return { error: 'That thread is not there any more.' };
  try {
    return await retryMentorReplyInRequest(user.id, chatId, advisorId);
  } catch (error) {
    console.error('mentor reply not retried', error);
    return { error: 'The reply could not start. Try again.' };
  }
}

// ---------------------------------------------------------------------------
// Adding and editing a person (plan #2748.11).
// ---------------------------------------------------------------------------

export type PersonSaveInput = {
  /** Empty for someone new. */
  advisorId: string;
  name: string;
  colour: string;
  brief: PersonBrief;
  persona: string;
  joinsMeetings: boolean;
  /** Who wrote the card as it is saved. */
  author: CardAuthor;
};

// latency: pending
export async function savePersonCard(input: PersonSaveInput): Promise<{ key: string } | { error: string }> {
  const user = await requireUser();
  const clean = cleanPersonForm(input);
  if (!clean.ok) return { error: clean.error };
  if (input.advisorId && !UUID.test(input.advisorId)) return { error: 'They are not on your council.' };
  const author: CardAuthor = {
    by: input.author?.by === 'dash' ? 'dash' : 'you',
    ask: typeof input.author?.ask === 'string' ? input.author.ask : null,
  };
  const client = await createYouClient();
  try {
    const key = input.advisorId
      ? await savePerson(client, user.id, input.advisorId, clean.value, author)
      : await addPerson(client, user.id, clean.value, author);
    revalidatePath('/chat', 'layout');
    return { key };
  } catch (error) {
    console.error('person not saved', error);
    return { error: input.advisorId ? 'Your changes were not saved. Try again.' : 'They were not added. Try again.' };
  }
}

// latency: pending
export async function draftPersonCard(input: {
  name: string;
  brief: PersonBrief;
  current?: string | null;
  ask?: string | null;
}): Promise<{ card: string } | { error: string }> {
  const user = await requireUser();
  const brief = briefOf(input.brief);
  brief.who = typeof input.brief?.who === 'string' ? input.brief.who.trim().slice(0, WHO_MAX) : '';
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, PERSON_NAME_MAX) : '';
  const ask = typeof input.ask === 'string' ? input.ask.trim().slice(0, ASK_MAX) : '';
  const current = typeof input.current === 'string' ? input.current.trim().slice(0, PERSONA_MAX) : '';
  const notReady = ask && current ? (name ? null : 'Give them a name first.') : draftReady(name, brief);
  if (notReady) return { error: notReady };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot draft cards.' };
  const reports: SpendReport[] = [];
  const drafted = await draftPersona(
    { name, brief, current: current || null, ask: ask || null },
    { apiKey, onSpend: (report) => reports.push(report) },
  );
  await recordSpendReports(await createCoreClient(), user.id, { module: 'you', operation: 'draft-persona' }, reports);
  return drafted.ok ? { card: drafted.card } : { error: drafted.error };
}

// latency: instant
export async function correctPersonMemory(id: string, text: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const line = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!UUID.test(id)) return { error: 'That line was not found.' };
  if (!line) return { error: 'Write the line, or remove it.' };
  if (line.length > MEMORY_LINE_MAX) return { error: `Keep it to ${MEMORY_LINE_MAX} characters.` };
  try {
    await correctMemory(await createYouClient(), user.id, id, line);
    revalidatePath('/chat', 'layout');
    return { error: null };
  } catch (error) {
    console.error('memory not corrected', error);
    return { error: 'That was not saved. Try again.' };
  }
}

// latency: instant
export async function removePersonMemory(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!UUID.test(id)) return { error: 'That line was not found.' };
  try {
    await forgetMemory(await createYouClient(), user.id, id);
    revalidatePath('/chat', 'layout');
    return { error: null };
  } catch (error) {
    console.error('memory not removed', error);
    return { error: 'That was not removed. Try again.' };
  }
}
