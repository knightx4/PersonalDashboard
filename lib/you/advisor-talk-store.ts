import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { loadAdvisorProfile, type AdvisorProfile } from '@/lib/you/board-profile';
import type { QuestionStatus } from '@/lib/you/board-questions';
import {
  MEMORY_KINDS,
  receiptsOf,
  TITLE_MAX,
  type AdvisorChat,
  type AdvisorMemory,
  type AdvisorMessage,
  type MemoryKind,
  type OpenDecision,
  type Receipt,
  type TalkContext,
  type TalkGoal,
} from '@/lib/you/advisor-talk';

/**
 * The rows a talk with one advisor reads and writes (plan #2581.6):
 * you.advisor_chats, you.advisor_messages and you.advisor_memory (you 0029),
 * and what the advisor is told about the person. Every read and write names
 * the user id, so a service-role client (the Dash check, the connector) stays
 * on the one account it was given.
 */

const CHAT_COLUMNS = 'id, title, created_at, last_message_at';
const MESSAGE_COLUMNS = 'id, role, text, receipts, created_at';
/** The most talks listed for one advisor. */
export const CHATS_LISTED = 50;
/** The most messages of one talk read. */
export const MESSAGES_READ = 400;
/** The decisions that count as open for a talk: asked and not yet settled. */
const OPEN: readonly QuestionStatus[] = ['queued', 'discussing', 'deferred'];

function chatOf(row: Record<string, unknown>): AdvisorChat {
  return {
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : null,
    createdAt: String(row.created_at),
    lastMessageAt: typeof row.last_message_at === 'string' ? row.last_message_at : null,
  };
}

function messageOf(row: Record<string, unknown>): AdvisorMessage {
  return {
    id: String(row.id),
    role: row.role === 'advisor' ? 'advisor' : 'person',
    text: String(row.text ?? ''),
    receipts: receiptsOf(row.receipts),
    createdAt: String(row.created_at),
  };
}

/** One advisor's talks, the latest first. */
export async function listAdvisorChats(
  you: YouSupabaseClient,
  userId: string,
  advisorId: string,
): Promise<AdvisorChat[]> {
  const { data, error } = await you
    .from('advisor_chats')
    .select(CHAT_COLUMNS)
    .eq('user_id', userId)
    .eq('advisor_id', advisorId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(CHATS_LISTED);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(chatOf);
}

/** One talk, when it is this advisor's. */
export async function loadAdvisorChat(
  you: YouSupabaseClient,
  userId: string,
  advisorId: string,
  chatId: string,
): Promise<AdvisorChat | null> {
  const { data, error } = await you
    .from('advisor_chats')
    .select(CHAT_COLUMNS)
    .eq('user_id', userId)
    .eq('advisor_id', advisorId)
    .eq('id', chatId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? chatOf(data as Record<string, unknown>) : null;
}

/** A talk's messages, oldest first. */
export async function loadAdvisorMessages(
  you: YouSupabaseClient,
  userId: string,
  chatId: string,
): Promise<AdvisorMessage[]> {
  const { data, error } = await you
    .from('advisor_messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(MESSAGES_READ);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(messageOf);
}

export async function startAdvisorChat(
  you: YouSupabaseClient,
  userId: string,
  advisorId: string,
  title: string,
): Promise<AdvisorChat> {
  const { data, error } = await you
    .from('advisor_chats')
    .insert({ user_id: userId, advisor_id: advisorId, title: title.slice(0, TITLE_MAX) || null })
    .select(CHAT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return chatOf(data as Record<string, unknown>);
}

export async function addAdvisorMessage(
  you: YouSupabaseClient,
  userId: string,
  chatId: string,
  message: { role: 'person' | 'advisor'; text: string; receipts?: readonly Receipt[] },
): Promise<AdvisorMessage> {
  const { data, error } = await you
    .from('advisor_messages')
    .insert({
      user_id: userId,
      chat_id: chatId,
      role: message.role,
      text: message.text,
      receipts: message.receipts ?? [],
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return messageOf(data as Record<string, unknown>);
}

/** What an advisor remembers and still holds true, oldest first. */
export async function loadAdvisorMemory(
  you: YouSupabaseClient,
  userId: string,
  advisorId: string,
): Promise<AdvisorMemory[]> {
  const { data, error } = await you
    .from('advisor_memory')
    .select('id, kind, text, created_at')
    .eq('user_id', userId)
    .eq('advisor_id', advisorId)
    .is('retired_at', null)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).flatMap((row): AdvisorMemory[] => {
    const kind = MEMORY_KINDS.find((k) => k === row.kind);
    return kind ? [{ id: String(row.id), kind, text: String(row.text), createdAt: String(row.created_at) }] : [];
  });
}

/** Keeps what one exchange taught the advisor, learnt from the person's message. */
export async function saveAdvisorMemory(
  you: YouSupabaseClient,
  userId: string,
  advisorId: string,
  rows: readonly { kind: MemoryKind; text: string }[],
  sourceMessageId: string | null,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await you.from('advisor_memory').insert(
    rows.map((row) => ({
      user_id: userId,
      advisor_id: advisorId,
      kind: row.kind,
      text: row.text,
      source_message_id: sourceMessageId,
    })),
  );
  if (error) throw new Error(error.message);
}

/**
 * Stops the advisor reading these memories: kept, with when, but no longer
 * told to any talk or meeting. Forget on the profile and the memory pass's
 * retirements both come here.
 */
export async function retireAdvisorMemory(
  you: YouSupabaseClient,
  userId: string,
  ids: readonly string[],
  advisorId?: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  let query = you
    .from('advisor_memory')
    .update({ retired_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('id', ids as string[])
    .is('retired_at', null);
  if (advisorId) query = query.eq('advisor_id', advisorId);
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/** Their decisions asked and not yet settled, newest first. */
export async function loadOpenDecisions(you: YouSupabaseClient, userId: string): Promise<OpenDecision[]> {
  const { data, error } = await you
    .from('board_questions')
    .select('id, question')
    .eq('user_id', userId)
    .in('status', OPEN as QuestionStatus[])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; question: string | null }[]).flatMap((row) =>
    row.question?.trim() ? [{ id: row.id, question: row.question.trim() }] : [],
  );
}

/** Their open goals, soonest due first. */
export async function loadTalkGoals(goals: GoalsSupabaseClient, userId: string): Promise<TalkGoal[]> {
  const { data, error } = await goals
    .from('items')
    .select('title, due_on')
    .eq('user_id', userId)
    .eq('level', 'goal')
    .eq('status', 'open')
    .is('archived_at', null)
    .order('due_on', { ascending: true, nullsFirst: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { title: string | null; due_on: string | null }[]).flatMap((row) =>
    row.title?.trim() ? [{ title: row.title.trim(), dueOn: row.due_on }] : [],
  );
}

/**
 * Everything a talk with this advisor is told, with their profile; null when
 * they are not on the person's board. A goals read that fails leaves the
 * goals out rather than the talk.
 */
export async function loadTalkContext(
  you: YouSupabaseClient,
  goals: GoalsSupabaseClient,
  userId: string,
  key: string,
): Promise<{ profile: AdvisorProfile; context: TalkContext } | null> {
  const profile = await loadAdvisorProfile(you, userId, key);
  if (!profile) return null;
  const [memory, open, goalRows] = await Promise.all([
    loadAdvisorMemory(you, userId, profile.advisor.id),
    loadOpenDecisions(you, userId),
    loadTalkGoals(goals, userId).catch((error: unknown) => {
      console.error('advisor talk: goals not read', error);
      return [] as TalkGoal[];
    }),
  ]);
  return {
    profile,
    context: {
      advisor: profile.advisor,
      brain: profile.brain,
      memory,
      decisions: profile.decisions,
      open,
      goals: goalRows,
    },
  };
}
