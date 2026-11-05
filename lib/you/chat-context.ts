import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { zoneDay } from '@/lib/core/when';
import { readBrain } from '@/lib/you/board-brain';
import { loadDevBrief } from '@/lib/you/builder-brief';
import { isBuilder } from '@/lib/you/builder-model';
import { memoryOf, type CouncilMemory } from '@/lib/you/council-model';
import {
  assembleChatContext,
  newestFromPerson,
  rankGoals,
  READ_LIMITS,
  recallQuery,
  refersBack,
  type ChatContext,
  type ChatContextInput,
  type ContextEpisode,
  type ContextGoal,
  type ContextLive,
  type ContextMentor,
  type ContextMessage,
  type ContextTodo,
} from '@/lib/you/chat-context-model';

export * from '@/lib/you/chat-context-model';

/**
 * The reads behind what a mentor knows before each reply (plan #2748.3); the
 * layers and their budgets are in chat-context-model.ts.
 *
 * Every read names the person as well as relying on row level security, so
 * the same function serves a service-role client (the reply run) and the
 * person's own. Reads are bounded by READ_LIMITS, never by the length of the
 * thread: a thread of five thousand messages costs the same reads as one of
 * fifty. The thread's own rows (chat, mentor, messages, episodes, memory)
 * must read or the reply is refused; the live rows (place, Now, todos,
 * goals) are extras, and one that fails to read is left out.
 */

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const strOrNull = (value: unknown): string | null => str(value) || null;
const rows = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);

const MESSAGE_COLUMNS = 'id, role, kind, text, created_at';

function messageRow(row: Record<string, unknown>): ContextMessage | null {
  const text = str(row.text);
  if (typeof row.id !== 'string' || !text) return null;
  const kind = row.kind === 'ack' || row.kind === 'text_first' ? row.kind : 'reply';
  return { id: row.id, role: row.role === 'advisor' ? 'advisor' : 'person', kind, text, createdAt: str(row.created_at) };
}

function episodeRow(row: Record<string, unknown>): ContextEpisode | null {
  const summary = str(row.summary);
  if (typeof row.id !== 'string' || !summary) return null;
  return {
    id: row.id,
    startedAt: str(row.started_at),
    endedAt: str(row.ended_at),
    messageCount: typeof row.message_count === 'number' ? row.message_count : 0,
    summary,
  };
}

function mentorRow(row: Record<string, unknown>): ContextMentor {
  return {
    id: str(row.id),
    key: str(row.key),
    name: str(row.name),
    kind: row.kind === 'seat' ? 'seat' : 'guest',
    question: str(row.question),
    focus: strOrNull(row.focus),
    persona: strOrNull(row.persona),
    brain: readBrain(row.brain),
    madeByYou: row.made_by_you === true,
  };
}

export type LoadChatContextOptions = {
  now: Date;
  /** The account's IANA zone (loadAccountSettings().timezone). */
  timeZone: string;
  /**
   * The message being answered. Defaults to the person's newest in the
   * thread; pass it when the reply run has it before the row is read back.
   */
  message?: string;
};

/**
 * Everything one reply in this chat reads, within budget. Throws when the
 * chat or its mentor cannot be read.
 */
export async function loadChatContext(
  client: YouSupabaseClient,
  userId: string,
  chatId: string,
  options: LoadChatContextOptions,
): Promise<ChatContext> {
  const input = await loadChatContextInput(client, userId, chatId, options);
  return assembleChatContext(input.input, input.message);
}

/** The rows behind a reply's context, before the budgets are applied, and the message a recall searches from. */
export async function loadChatContextInput(
  client: YouSupabaseClient,
  userId: string,
  chatId: string,
  options: LoadChatContextOptions,
): Promise<{ input: ChatContextInput; message: string | null }> {
  const chat = await client.from('advisor_chats').select('id, advisor_id').eq('id', chatId).eq('user_id', userId).maybeSingle();
  if (chat.error) throw new Error(`Reading the chat failed: ${chat.error.message}`);
  const advisorId = str((chat.data as Record<string, unknown> | null)?.advisor_id);
  if (!advisorId) throw new Error('That chat was not found.');

  const [advisor, memory, recent, episodes] = await Promise.all([
    client
      .from('board_advisors')
      .select('id, key, name, kind, question, focus, persona, brain, made_by_you')
      .eq('id', advisorId)
      .eq('user_id', userId)
      .maybeSingle(),
    client
      .from('advisor_memory')
      .select('id, kind, text, due_on, done_at, created_at')
      .eq('user_id', userId)
      .eq('advisor_id', advisorId)
      .is('retired_at', null)
      .order('created_at', { ascending: false })
      .limit(READ_LIMITS.memory),
    client
      .from('advisor_messages')
      .select(MESSAGE_COLUMNS)
      .eq('user_id', userId)
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(READ_LIMITS.recent),
    client
      .from('advisor_episodes')
      .select('id, started_at, ended_at, message_count, summary')
      .eq('user_id', userId)
      .eq('chat_id', chatId)
      .not('summary', 'is', null)
      .order('started_at', { ascending: false })
      .limit(READ_LIMITS.episodes),
  ]);
  for (const [what, r] of [
    ['the mentor', advisor],
    ['their memory', memory],
    ['the thread', recent],
    ['earlier conversations', episodes],
  ] as const) {
    if (r.error) throw new Error(`Reading ${what} failed: ${r.error.message}`);
  }
  if (!advisor.data) throw new Error("That chat's mentor was not found.");
  const mentor = mentorRow(advisor.data as Record<string, unknown>);

  const recentMessages = rows(recent.data)
    .flatMap((row) => messageRow(row) ?? [])
    .reverse();
  const message = options.message?.trim() || newestFromPerson(recentMessages)?.text || null;

  const query = message && refersBack(message) ? recallQuery(message) : null;
  const windowStart = recentMessages[0]?.createdAt ?? null;
  const [recall, live] = await Promise.all([
    query && recentMessages.length >= READ_LIMITS.recent && windowStart
      ? loadRecall(client, userId, chatId, query, windowStart)
      : Promise.resolve([] as ContextMessage[]),
    loadLive(client, userId, mentor, message ?? '', options),
  ]);

  const memoryRows: CouncilMemory[] = rows(memory.data).flatMap((row) => memoryOf(row) ?? []);
  return {
    input: {
      mentor,
      memory: memoryRows,
      episodes: rows(episodes.data).flatMap((row) => episodeRow(row) ?? []),
      recall,
      recent: recentMessages,
      live,
    },
    message,
  };
}

/**
 * Older messages holding the query's words, from before the recent window.
 * Only asked for when the window is full: a thread that fits in it has no
 * older messages to find.
 */
async function loadRecall(
  client: YouSupabaseClient,
  userId: string,
  chatId: string,
  query: string,
  before: string,
): Promise<ContextMessage[]> {
  const { data, error } = await client
    .from('advisor_messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .lt('created_at', before)
    .textSearch('search', query, { type: 'websearch', config: 'english' })
    .order('created_at', { ascending: false })
    .limit(READ_LIMITS.recallCandidates);
  if (error) return [];
  return rows(data).flatMap((row) => messageRow(row) ?? []);
}

async function loadLive(
  client: YouSupabaseClient,
  userId: string,
  mentor: ContextMentor,
  message: string,
  { now, timeZone }: LoadChatContextOptions,
): Promise<ContextLive> {
  // The builder reads the plan in place of todos and goals (plan #2854.5).
  if (isBuilder(mentor)) {
    return { now, timeZone, place: null, nowNote: null, todos: [], goals: [], dev: await loadDevBrief(client, userId, now) };
  }
  const today = zoneDay(now, timeZone);
  const todo = client.schema('todo') as unknown as YouSupabaseClient;
  const goals = client.schema('goals') as unknown as YouSupabaseClient;
  const [place, nowNote, todos, goalRows, areas] = await Promise.all([
    client
      .from('places')
      .select('name, city, region, country, moved_in')
      .eq('user_id', userId)
      .is('moved_out', null)
      .order('moved_in', { ascending: false, nullsFirst: false })
      .limit(1),
    client.from('now').select('body').eq('user_id', userId).maybeSingle(),
    todo
      .from('tasks')
      .select('title, due_on, pinned, snoozed_until')
      .eq('user_id', userId)
      .eq('status', 'open')
      .or(`pinned.eq.true,due_on.lte.${today}`)
      .order('due_on', { ascending: true, nullsFirst: false })
      .limit(READ_LIMITS.todos * 2),
    goals
      .from('items')
      .select('id, title, detail, due_on, area_id')
      .eq('user_id', userId)
      .eq('level', 'goal')
      .eq('status', 'open')
      .is('archived_at', null)
      .is('closed_at', null)
      .limit(READ_LIMITS.goals),
    goals.from('areas').select('id, name').eq('user_id', userId),
  ]);

  const placeRow = place.error ? null : rows(place.data)[0];
  const placeText = placeRow
    ? [str(placeRow.city) || str(placeRow.name), str(placeRow.country)].filter(Boolean).join(', ') || null
    : null;

  const nowMs = now.getTime();
  const todoList: ContextTodo[] = todos.error
    ? []
    : rows(todos.data)
        .filter((t) => {
          const snoozed = Date.parse(str(t.snoozed_until));
          return str(t.title) && !(Number.isFinite(snoozed) && snoozed > nowMs);
        })
        .slice(0, READ_LIMITS.todos)
        .map((t) => ({ title: str(t.title), dueOn: strOrNull(t.due_on), pinned: t.pinned === true }));

  const areaName = new Map(areas.error ? [] : rows(areas.data).map((a) => [str(a.id), str(a.name)] as const));
  const goalList: ContextGoal[] = goalRows.error
    ? []
    : rows(goalRows.data).flatMap((g) =>
        str(g.id) && str(g.title)
          ? [{ id: str(g.id), title: str(g.title), detail: strOrNull(g.detail), area: areaName.get(str(g.area_id)) || null, dueOn: strOrNull(g.due_on) }]
          : [],
      );

  return {
    now,
    timeZone,
    place: placeText,
    nowNote: nowNote.error ? null : strOrNull((nowNote.data as Record<string, unknown> | null)?.body),
    todos: todoList,
    goals: rankGoals(goalList, mentor, message),
  };
}
