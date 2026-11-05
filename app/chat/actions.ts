'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadBuildRuns } from '@/lib/talk/build-runs';
import type { BuildRun } from '@/lib/you/live-cards';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { createYouClient } from '@/lib/you/auth/server';
import { setBotPhoto } from '@/lib/you/bot-photos';
import { forgetMemory, markMentorRead } from '@/lib/you/council';
import { loadThreadPage, markThreadRead, startChat, threadHref, type ThreadPage } from '@/lib/you/chat-threads';
import { withMessageFiles } from '@/lib/you/chat-message-files';
import {
  createGroup,
  deleteGroup,
  groupHref,
  loadGroupThreadPage,
  renameGroup,
  setGroupMembers,
  type Reacted,
} from '@/lib/you/group-chats';
import { retryMentorReplyInRequest } from '@/lib/you/mentor-reply-request';
import { loadPeopleChanges, type DashChange } from '@/lib/talk/changes';
import {
  addPerson,
  ASK_MAX,
  briefOf,
  cleanPersonForm,
  correctMemory,
  deletePerson,
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
import { loadReachOutView, turnOffReachOut } from '@/lib/you/reach-out-card';
import type { ReachOutView } from '@/lib/you/reach-out-card-model';
import { makeReachOutRule, saveReachOut, type MadeReachOut } from '@/lib/you/reach-out-make';
import { REACH_OUT_LIMITS } from '@/lib/you/reach-out-rule';

/**
 * The People tab's presses that are not a send (plan #2748.6): reading the
 * page of a thread before the oldest one shown, and reading a thread, which
 * having it open does. A send goes through POST /api/chat/messages. Then
 * adding and editing a person and what they remember (plan #2748.11),
 * deleting one from the Bots tab (plan #2879.3), and what each texts you
 * about (plan #2931.3).
 */

const KEY = /^[a-z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// latency: pending
export async function olderMessages(chatId: string, before: string): Promise<ThreadPage | { error: string }> {
  const user = await requireUser();
  if (!UUID.test(chatId) || !Number.isFinite(Date.parse(before))) return { error: 'Those messages cannot be read.' };
  try {
    const page = await loadThreadPage(await createYouClient(), user.id, chatId, before);
    return { ...page, messages: await withMessageFiles(await createCoreClient(), page.messages) };
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

/**
 * Where the builds a thread started stand (plan #2854.3), read again when one
 * of their runs or reports changes, so the card follows the build without a
 * reload. Null when they could not be read; the thread keeps what it has.
 */
// latency: instant
export async function threadBuilds(runIds: string[]): Promise<Record<string, BuildRun> | null> {
  await requireUser();
  if (!Array.isArray(runIds) || !runIds.every((id) => typeof id === 'string' && UUID.test(id))) return null;
  try {
    return await loadBuildRuns(await createClient(), await createCoreClient(), runIds);
  } catch (error) {
    console.error('thread builds not read', error);
    return null;
  }
}

/** New message (plan #2879.2): start the chat with them, or find the one there is, and say where it is. */
// latency: pending
export async function startChatWith(key: string): Promise<{ href: string } | { error: string }> {
  const user = await requireUser();
  if (!KEY.test(key)) return { error: 'That chat cannot be started.' };
  try {
    const started = await startChat(await createYouClient(), user.id, key);
    if (!started) return { error: 'They are not on your list any more.' };
    revalidatePath('/chat');
    return { href: threadHref(key) };
  } catch (error) {
    console.error('chat not started', error);
    return { error: 'The chat could not be started. Try again.' };
  }
}

// ---------------------------------------------------------------------------
// Group chats (plan #2879.1.3).
// ---------------------------------------------------------------------------

const keysOf = (keys: unknown): string[] | null =>
  Array.isArray(keys) && keys.length <= 20 && keys.every((k) => typeof k === 'string' && KEY.test(k)) ? (keys as string[]) : null;

/** New message with two to eight picked: start the group and say where it is. */
// latency: pending
export async function startGroupWith(keys: string[], name: string): Promise<{ href: string } | { error: string }> {
  const user = await requireUser();
  const picked = keysOf(keys);
  if (!picked) return { error: 'That group cannot be started.' };
  try {
    const made = await createGroup(await createYouClient(), user.id, { keys: picked, title: typeof name === 'string' ? name : null });
    if (!made.ok) return { error: made.error };
    revalidatePath('/chat');
    return { href: groupHref(made.value.chatId) };
  } catch (error) {
    console.error('group not started', error);
    return { error: 'The group could not be started. Try again.' };
  }
}

/** A group's settings saved: its name and who is in it, together. */
// latency: pending
export async function saveGroup(chatId: string, input: { name: string; keys: string[] }): Promise<{ error: string | null }> {
  const user = await requireUser();
  const picked = keysOf(input?.keys);
  if (!UUID.test(chatId) || !picked) return { error: 'That group cannot be changed.' };
  const client = await createYouClient();
  try {
    const renamed = await renameGroup(client, user.id, chatId, typeof input.name === 'string' ? input.name : '');
    if (!renamed.ok) return { error: renamed.error };
    const changed = await setGroupMembers(client, user.id, chatId, picked);
    if (!changed.ok) return { error: changed.error };
    revalidatePath('/chat', 'layout');
    return { error: null };
  } catch (error) {
    console.error('group not saved', error);
    return { error: 'Your changes were not saved. Try again.' };
  }
}

/** Delete a group with everything said in it. */
// latency: pending
export async function deleteGroupChat(chatId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!UUID.test(chatId)) return { error: 'That group is not there.' };
  try {
    const gone = await deleteGroup(await createYouClient(), user.id, chatId);
    if (!gone) return { error: 'That group is not there any more.' };
    revalidatePath('/chat', 'layout');
    return { error: null };
  } catch (error) {
    console.error('group not deleted', error);
    return { error: 'The group was not deleted. Try again.' };
  }
}

// latency: pending
export async function olderGroupMessages(
  chatId: string,
  before: string,
): Promise<{ messages: ThreadPage['messages']; hasOlder: boolean; reactions: Record<string, Reacted[]> } | { error: string }> {
  const user = await requireUser();
  if (!UUID.test(chatId) || !Number.isFinite(Date.parse(before))) return { error: 'Those messages cannot be read.' };
  try {
    return await loadGroupThreadPage(await createYouClient(), user.id, chatId, before);
  } catch (error) {
    console.error('older group messages not read', error);
    return { error: 'Earlier messages could not be read.' };
  }
}

// latency: instant
export async function readGroup(chatId: string): Promise<void> {
  const user = await requireUser();
  if (!UUID.test(chatId)) return;
  try {
    await markThreadRead(await createYouClient(), user.id, chatId);
  } catch (error) {
    console.error('group not marked read', error);
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
  /** What they text first about, for someone with a rule (plan #2854.1). */
  textWhen?: string[];
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

/**
 * A bot's picture (plan #2955): point them at the image the form has just
 * uploaded to their folder of the you-bot-photos bucket, or at none with
 * null, which draws their initials again. The picture replaced is removed.
 */
// latency: pending
export async function saveBotPhoto(advisorId: string, path: string | null): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!UUID.test(advisorId)) return { error: 'They are not on your list.' };
  if (path !== null && typeof path !== 'string') return { error: 'That picture was not saved. Try again.' };
  try {
    const found = await setBotPhoto(await createYouClient(), user.id, advisorId, path);
    if (!found) return { error: 'They are not on your list.' };
    revalidatePath('/chat', 'layout');
    return { error: null };
  } catch (error) {
    console.error('bot picture not saved', error);
    return { error: path ? 'That picture was not saved. Try again.' : 'The picture was not taken off. Try again.' };
  }
}

/** Delete from the Bots tab (plan #2879.3): the bot, its chats and what it remembers. */
// latency: pending
export async function deletePersonCard(advisorId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!UUID.test(advisorId)) return { error: 'They are not on your list.' };
  try {
    const gone = await deletePerson(await createYouClient(), user.id, advisorId);
    if (!gone) return { error: 'Only a bot you or Dash added can be deleted.' };
    revalidatePath('/chat', 'layout');
    return { error: null };
  } catch (error) {
    console.error('person not deleted', error);
    return { error: 'They were not deleted. Try again.' };
  }
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

/**
 * Set it up on a person's form (plan #2931.3): Dash makes the rule from what
 * you wrote (lib/you/reach-out-make.ts), the brief is kept with the rule or
 * with why none could be made, and the form gets back what to show. An
 * empty brief clears it all.
 */
// latency: pending -- a model call; the box says Dash is setting it up
export async function setReachOut(advisorId: string, brief: string): Promise<{ view: ReachOutView } | { error: string }> {
  const user = await requireUser();
  if (!UUID.test(advisorId)) return { error: 'They are not on your list.' };
  const words = typeof brief === 'string' ? brief.trim() : '';
  if (words.length > REACH_OUT_LIMITS.brief) return { error: `Keep it under ${REACH_OUT_LIMITS.brief} characters.` };
  const client = await createYouClient();
  const found = await client.from('board_advisors').select('name').eq('user_id', user.id).eq('id', advisorId).eq('active', true).maybeSingle();
  if (found.error || typeof found.data?.name !== 'string') return { error: 'They are not on your list.' };
  let made: MadeReachOut | null = null;
  if (words) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot set this up.' };
    const reports: SpendReport[] = [];
    made = await makeReachOutRule({ name: found.data.name, brief: words }, { apiKey, onSpend: (report) => reports.push(report) });
    await recordSpendReports(await createCoreClient(), user.id, { module: 'you', operation: 'make-reach-out-rule' }, reports);
  }
  try {
    await saveReachOut(client, user.id, advisorId, words, made);
    const view = await loadReachOutView(client, user.id, advisorId, Date.now());
    revalidatePath('/chat', 'layout');
    return { view };
  } catch (error) {
    console.error('reach-out not saved', error);
    return { error: 'What you wrote was not saved. Try again.' };
  }
}

/** Turn off on a person's form (plan #2931.3): the rule goes, your words stay. */
// latency: pending -- one write
export async function turnOffPersonReachOut(advisorId: string): Promise<{ view: ReachOutView } | { error: string }> {
  const user = await requireUser();
  if (!UUID.test(advisorId)) return { error: 'They are not on your list.' };
  const client = await createYouClient();
  try {
    await turnOffReachOut(client, user.id, advisorId);
    const view = await loadReachOutView(client, user.id, advisorId, Date.now());
    revalidatePath('/chat', 'layout');
    return { view };
  } catch (error) {
    console.error('reach-out not turned off', error);
    return { error: 'It was not turned off. Try again.' };
  }
}
