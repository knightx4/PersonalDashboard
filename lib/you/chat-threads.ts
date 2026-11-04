import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { listRoster, type RosterAdvisor } from '@/lib/you/board-advisors';
import { canTalkOf } from '@/lib/you/people-cards-model';
import {
  mentorColour,
  SEARCH_MAX,
  seatAreaOf,
  sortPeople,
  THREAD_MESSAGE_COLUMNS,
  THREAD_PAGE,
  threadMessageOf,
  type PersonRow,
  type SearchHit,
  type ThreadPage,
} from '@/lib/you/chat-threads-model';

export * from '@/lib/you/chat-threads-model';

/**
 * The People tab's reads and the one write opening a thread makes (plan
 * #2748.6). Every query names the person as well as relying on row level
 * security. Sending goes through POST /api/chat/messages
 * (lib/you/mentor-reply-request.ts), not through here.
 */

type ChatRow = { id: string; advisorId: string; typingUntil: string | null; lastReadAt: string | null };

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const strOrNull = (value: unknown): string | null => str(value) || null;

function rows<T>(found: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (found.error) throw new Error(`Reading ${what} failed: ${found.error.message}`);
  return (Array.isArray(found.data) ? found.data : []) as T[];
}

/** Each mentor's newest thread, and their colours. */
async function readChats(client: YouSupabaseClient, userId: string): Promise<{ chats: Map<string, ChatRow>; colours: Map<string, string | null> }> {
  const [chats, colours] = await Promise.all([
    client
      .from('advisor_chats')
      .select('id, advisor_id, typing_until, last_read_at, last_message_at')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false, nullsFirst: false }),
    client.from('board_advisors').select('id, colour').eq('user_id', userId),
  ]);
  const byAdvisor = new Map<string, ChatRow>();
  for (const row of rows<Record<string, unknown>>(chats, 'your threads')) {
    const advisorId = str(row.advisor_id);
    if (typeof row.id !== 'string' || !advisorId || byAdvisor.has(advisorId)) continue;
    byAdvisor.set(advisorId, {
      id: row.id,
      advisorId,
      typingUntil: strOrNull(row.typing_until),
      lastReadAt: strOrNull(row.last_read_at),
    });
  }
  const colourOf = new Map<string, string | null>();
  for (const row of rows<Record<string, unknown>>(colours, 'your mentors')) {
    if (typeof row.id === 'string') colourOf.set(row.id, strOrNull(row.colour));
  }
  return { chats: byAdvisor, colours: colourOf };
}

async function personRow(
  client: YouSupabaseClient,
  userId: string,
  advisor: RosterAdvisor,
  chat: ChatRow | undefined,
  colour: string | null,
): Promise<PersonRow> {
  const base: PersonRow = {
    id: advisor.id,
    key: advisor.key,
    name: advisor.name,
    about: seatAreaOf(advisor),
    colour: mentorColour(advisor.key, colour),
    canTalk: canTalkOf(advisor),
    chatId: chat?.id ?? null,
    last: null,
    unread: false,
    typingUntil: chat?.typingUntil ?? null,
    lastReadAt: chat?.lastReadAt ?? null,
  };
  if (!chat) return base;
  let unreadQuery = client
    .from('advisor_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('chat_id', chat.id)
    .eq('role', 'advisor')
    .is('read_at', null);
  if (chat.lastReadAt) unreadQuery = unreadQuery.gt('created_at', chat.lastReadAt);
  const [last, unread] = await Promise.all([
    client
      .from('advisor_messages')
      .select('role, text, created_at')
      .eq('user_id', userId)
      .eq('chat_id', chat.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    unreadQuery,
  ]);
  if (last.error) throw new Error(`Reading your thread with ${advisor.name} failed: ${last.error.message}`);
  if (unread.error) throw new Error(`Reading your thread with ${advisor.name} failed: ${unread.error.message}`);
  const row = last.data as Record<string, unknown> | null;
  const text = str(row?.text);
  return {
    ...base,
    last: row && text ? { text, role: row.role === 'advisor' ? 'advisor' : 'person', at: str(row.created_at) } : null,
    unread: (unread.count ?? 0) > 0,
  };
}

/** Everyone on the council, as the People list draws them, newest thread first. */
export async function loadPeople(client: YouSupabaseClient, userId: string): Promise<PersonRow[]> {
  const [roster, { chats, colours }] = await Promise.all([listRoster(client, userId), readChats(client, userId)]);
  const people = await Promise.all(
    roster
      .filter((a) => a.active)
      .map((a) => personRow(client, userId, a, chats.get(a.id), colours.get(a.id) ?? null)),
  );
  return sortPeople(people);
}

/** The newest page of a thread, or the page before `before` (a message's created_at). */
export async function loadThreadPage(
  client: YouSupabaseClient,
  userId: string,
  chatId: string,
  before?: string | null,
): Promise<ThreadPage> {
  let query = client
    .from('advisor_messages')
    .select(THREAD_MESSAGE_COLUMNS)
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(THREAD_PAGE + 1);
  if (before) query = query.lt('created_at', before);
  const found = rows<Record<string, unknown>>(await query, 'your thread');
  const messages = found
    .slice(0, THREAD_PAGE)
    .flatMap((row) => {
      const m = threadMessageOf(row);
      return m ? [m] : [];
    })
    .reverse();
  return { messages, hasOlder: found.length > THREAD_PAGE };
}

/**
 * Opening a thread reads it: the thread's last_read_at moves to now, and the
 * mentor's messages not yet delivered or read are marked both.
 */
export async function markThreadRead(
  client: YouSupabaseClient,
  userId: string,
  chatId: string,
  now: number = Date.now(),
): Promise<void> {
  const at = new Date(now).toISOString();
  const results = await Promise.all([
    client.from('advisor_chats').update({ last_read_at: at }).eq('user_id', userId).eq('id', chatId),
    client
      .from('advisor_messages')
      .update({ delivered_at: at })
      .eq('user_id', userId)
      .eq('chat_id', chatId)
      .eq('role', 'advisor')
      .is('delivered_at', null),
    client
      .from('advisor_messages')
      .update({ read_at: at })
      .eq('user_id', userId)
      .eq('chat_id', chatId)
      .eq('role', 'advisor')
      .is('read_at', null),
  ]);
  for (const r of results) {
    if (r.error) throw new Error(`Marking the thread read failed: ${r.error.message}`);
  }
}

/** Messages in any thread with these words, newest first, through the full-text index on you.advisor_messages.search. */
export async function searchThreads(
  client: YouSupabaseClient,
  userId: string,
  text: string,
  people: readonly PersonRow[],
): Promise<SearchHit[]> {
  const byChat = new Map(people.flatMap((p) => (p.chatId ? [[p.chatId, p] as const] : [])));
  if (byChat.size === 0) return [];
  const found = await client
    .from('advisor_messages')
    .select('id, chat_id, role, text, created_at')
    .eq('user_id', userId)
    .in('chat_id', [...byChat.keys()])
    .textSearch('search', text, { type: 'websearch', config: 'english' })
    .order('created_at', { ascending: false })
    .limit(SEARCH_MAX);
  return rows<Record<string, unknown>>(found, 'your messages').flatMap((row) => {
    const person = byChat.get(str(row.chat_id));
    const body = str(row.text);
    if (!person || typeof row.id !== 'string' || !body) return [];
    return [
      {
        id: row.id,
        key: person.key,
        name: person.name,
        colour: person.colour,
        role: row.role === 'advisor' ? ('advisor' as const) : ('person' as const),
        text: body,
        at: str(row.created_at),
      },
    ];
  });
}
