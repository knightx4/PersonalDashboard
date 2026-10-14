import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import {
  askTitle,
  toTalkTurn,
  TURN_SELECT,
  type NewTalkTurn,
  type SubjectKind,
  type TalkSubject,
  type TalkTurn,
  type TalkTurnRow,
} from './talk';
import { chatWorkspaces, containsPattern, dayIn, matchSnippet, type AskChat } from './ask-chats';

/**
 * Reading and writing conversations through the person's own session
 * (plan #1053). RLS limits every read and write to their own rows, and the
 * composite foreign key stops a turn being added to another account's
 * conversation.
 *
 * A `row` thread's ref must name a row of the writer's own: the database
 * checks it when the conversation starts (core.refs_check, migration 0165),
 * so starting a thread under somebody else's row, or under a row that is gone,
 * fails here with ROW_NOT_YOURS.
 */

/** What appendTurns says when the database refuses a row thread's ref. */
export const ROW_NOT_YOURS = 'That row is not one of yours, or it is no longer there.';

type ConversationRow = {
  subject_ref: string;
  conversation_turns: TalkTurnRow[] | null;
};

const byTime = (a: TalkTurn, b: TalkTurn) => a.createdAt.localeCompare(b.createdAt);

/**
 * The turns of every conversation about the given subjects of one kind, by
 * ref, oldest first. A subject with no conversation, or one with no turns, is
 * absent from the map.
 */
export async function loadConversations(
  core: CoreSupabaseClient,
  kind: SubjectKind,
  refs: readonly string[],
): Promise<Map<string, TalkTurn[]>> {
  const byRef = new Map<string, TalkTurn[]>();
  if (refs.length === 0) return byRef;

  const { data, error } = await core
    .from('conversations')
    .select(`subject_ref, conversation_turns (${TURN_SELECT})`)
    .eq('subject_kind', kind)
    .in('subject_ref', [...new Set(refs)]);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading your conversations failed: ${error.message}`);

  for (const row of (data ?? []) as ConversationRow[]) {
    const turns = (row.conversation_turns ?? []).map(toTalkTurn).sort(byTime);
    if (turns.length > 0) byRef.set(row.subject_ref, turns);
  }
  return byRef;
}

/** The turns of the conversation about one subject, oldest first; empty when there is none. */
export async function loadConversation(
  core: CoreSupabaseClient,
  subject: Pick<TalkSubject, 'kind' | 'ref'>,
): Promise<TalkTurn[]> {
  const byRef = await loadConversations(core, subject.kind, [subject.ref]);
  return byRef.get(subject.ref) ?? [];
}

/**
 * Adds turns to the conversation about a subject, starting it if there is
 * none, and returns the turns as written.
 *
 * Several turns in one call go in as one insert, and the table's
 * clock_timestamp() default keeps them in the order given: a question and its
 * reply are written together that way. Write the question on its own first
 * when the reply may fail, so a closed tab or a failed call keeps it.
 */
export async function appendTurns(
  core: CoreSupabaseClient,
  userId: string,
  subject: TalkSubject,
  turns: readonly NewTalkTurn[],
): Promise<TalkTurn[]> {
  if (turns.length === 0) return [];

  // Starting it is a no-op when it exists, so the title it began with stays.
  // An `ask` conversation's id is its ref (conversations_ask_ref_ck), and the
  // check runs before the conflict is found, so the id goes in with it.
  const { error: startError } = await core.from('conversations').upsert(
    {
      ...(subject.kind === 'ask' ? { id: subject.ref } : {}),
      user_id: userId,
      subject_kind: subject.kind,
      subject_ref: subject.ref,
      title: subject.title?.trim() || null,
    },
    { onConflict: 'user_id,subject_kind,subject_ref', ignoreDuplicates: true },
  );
  assertSchemaExposed(startError, CORE_SCHEMA);
  if (startError && /is not a row of yours/.test(startError.message)) throw new Error(ROW_NOT_YOURS);
  if (startError) throw new Error(`Starting the conversation failed: ${startError.message}`);

  const { data: conversation, error: readError } = await core
    .from('conversations')
    .select('id')
    .eq('subject_kind', subject.kind)
    .eq('subject_ref', subject.ref)
    .maybeSingle();
  if (readError) throw new Error(`Reading the conversation failed: ${readError.message}`);
  if (!conversation) throw new Error('The conversation was not there after starting it.');

  const { data, error } = await core
    .from('conversation_turns')
    .insert(
      turns.map((turn) => ({
        conversation_id: (conversation as { id: string }).id,
        user_id: userId,
        role: turn.role,
        body: turn.body,
        // Only Dash's turns carry tool calls (conversation_turns_tool_calls_ck).
        // Citations are an answer's rows, or on a question the rows the
        // person added with @ (plan #1899.5). An empty list is stored as nothing.
        ...(turn.role === 'assistant' && turn.toolCalls?.length ? { tool_calls: turn.toolCalls } : {}),
        ...(turn.citations?.length ? { citations: turn.citations } : {}),
      })),
    )
    .select(TURN_SELECT);
  if (error) throw new Error(`Keeping that failed: ${error.message}`);
  return ((data ?? []) as TalkTurnRow[]).map(toTalkTurn).sort(byTime);
}

/**
 * Starts a conversation for a question asked from anywhere (kind `ask`, plan
 * #1086) and returns its subject, for appendTurns and loadConversation. Every
 * question starts a new one: the id is made here so the ref can be the same
 * id, which the table checks. The title is the question, cut to one line.
 */
export async function startAsk(
  core: CoreSupabaseClient,
  userId: string,
  question: string,
): Promise<TalkSubject & { kind: 'ask' }> {
  const id = crypto.randomUUID();
  const title = askTitle(question) || null;
  const { error } = await core
    .from('conversations')
    .insert({ id, user_id: userId, subject_kind: 'ask', subject_ref: id, title });
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Starting the conversation failed: ${error.message}`);
  return { kind: 'ask', ref: id, title };
}

/** One conversation in a list of them, newest activity first. */
export type ConversationSummary = {
  id: string;
  kind: SubjectKind;
  ref: string;
  title: string | null;
  createdAt: string;
  /** When the last turn was written; the start when it has none. */
  lastAt: string;
  turnCount: number;
};

type SummaryRow = {
  id: string;
  subject_kind: string;
  subject_ref: string;
  title: string | null;
  created_at: string;
  conversation_turns: { created_at: string }[] | null;
};

/**
 * The conversations of one kind, most recently added to first: the list of
 * past questions that reopens them (plan #1090). Reads the most recently
 * started `limit` and orders those by their last turn.
 */
export async function listConversations(
  core: CoreSupabaseClient,
  kind: SubjectKind,
  limit = 50,
): Promise<ConversationSummary[]> {
  const { data, error } = await core
    .from('conversations')
    .select('id, subject_kind, subject_ref, title, created_at, conversation_turns (created_at)')
    .eq('subject_kind', kind)
    // An archived chat leaves every list but the Archived one on /ask (plan #1899.6).
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading your conversations failed: ${error.message}`);

  return ((data ?? []) as SummaryRow[])
    .map((row) => {
      const turns = row.conversation_turns ?? [];
      const lastAt = turns.reduce((last, turn) => (turn.created_at > last ? turn.created_at : last), row.created_at);
      return {
        id: row.id,
        kind: row.subject_kind as SubjectKind,
        ref: row.subject_ref,
        title: row.title,
        createdAt: row.created_at,
        lastAt,
        turnCount: turns.length,
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

type ChatRow = {
  id: string;
  subject_ref: string;
  title: string | null;
  created_at: string;
  pinned_at: string | null;
  archived_at: string | null;
  conversation_turns:
    | { created_at: string; citations: TalkTurnRow['citations']; tool_calls: TalkTurnRow['tool_calls'] }[]
    | null;
};

/**
 * The person's chats with Dash for the list on /ask (plan #1899.2), most
 * recently added to first, each with the workspaces it read or changed. Those
 * are worked out from each turn's citations and lookups (lib/talk/ask-chats.ts)
 * and only the workspace ids leave the server, since a turn's lookups can run
 * to tens of kilobytes.
 */
export async function listAskChats(
  core: CoreSupabaseClient,
  timezone: string,
  limit = 200,
): Promise<AskChat[]> {
  const { data, error } = await core
    .from('conversations')
    .select(
      'id, subject_ref, title, created_at, pinned_at, archived_at, conversation_turns (created_at, citations, tool_calls)',
    )
    .eq('subject_kind', 'ask')
    .order('created_at', { ascending: false })
    .limit(limit);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading your chats with Dash failed: ${error.message}`);

  return ((data ?? []) as ChatRow[])
    .map((row) => {
      const turns = row.conversation_turns ?? [];
      const lastAt = turns.reduce((last, turn) => (turn.created_at > last ? turn.created_at : last), row.created_at);
      return {
        id: row.id,
        ref: row.subject_ref,
        title: row.title,
        lastAt,
        day: dayIn(lastAt, timezone),
        pinnedAt: row.pinned_at,
        archivedAt: row.archived_at,
        workspaces: chatWorkspaces(
          turns.map((turn) => ({
            citations: Array.isArray(turn.citations) ? turn.citations : null,
            toolCalls: Array.isArray(turn.tool_calls) ? turn.tool_calls : null,
          })),
        ),
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** What can be changed about one chat with Dash from the list on /ask (plan #1899.6). */
export type AskChatEdit = { title: string } | { pinned: boolean } | { archived: boolean };

/**
 * Rename, pin or archive one of the person's chats with Dash. Whose chat it
 * is decides RLS, so a ref that is not theirs changes nothing and reads as
 * not there. Archiving unpins, so a chat brought back from Archived returns
 * to its day rather than to the top.
 */
export async function editAskChat(core: CoreSupabaseClient, ref: string, edit: AskChatEdit): Promise<boolean> {
  const now = new Date().toISOString();
  const patch =
    'title' in edit
      ? { title: edit.title }
      : 'pinned' in edit
        ? { pinned_at: edit.pinned ? now : null }
        : edit.archived
          ? { archived_at: now, pinned_at: null }
          : { archived_at: null };
  const { data, error } = await core
    .from('conversations')
    .update(patch)
    .eq('subject_kind', 'ask')
    .eq('subject_ref', ref)
    .select('id');
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Changing the chat failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** One chat the search found by what was said in it, with the words around the match. */
export type AskChatHit = { ref: string; snippet: string };

/**
 * The person's chats with Dash in which `query` was said, by them or by
 * Dash (plan #1899.6), each once, with the newest turn that says it. Reads
 * through the turns' trigram index (0239), and RLS keeps it to their own.
 */
export async function searchAskChats(core: CoreSupabaseClient, query: string, limit = 40): Promise<AskChatHit[]> {
  const { data, error } = await core
    .from('conversation_turns')
    .select('body, created_at, conversations!inner (subject_ref, subject_kind)')
    .eq('conversations.subject_kind', 'ask')
    .ilike('body', containsPattern(query))
    .order('created_at', { ascending: false })
    .limit(200);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Searching your chats failed: ${error.message}`);

  const hits = new Map<string, AskChatHit>();
  type HitRow = { body: string; conversations: { subject_ref: string } | { subject_ref: string }[] | null };
  for (const row of (data ?? []) as unknown as HitRow[]) {
    const conversation = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations;
    if (!conversation || hits.has(conversation.subject_ref)) continue;
    const snippet = matchSnippet(row.body, query);
    if (snippet) hits.set(conversation.subject_ref, { ref: conversation.subject_ref, snippet });
    if (hits.size >= limit) break;
  }
  return [...hits.values()];
}

/** One chat's own name and whether it is archived, or null when it is not theirs or not there. */
export async function loadAskChatMeta(
  core: CoreSupabaseClient,
  ref: string,
): Promise<{ title: string | null; archivedAt: string | null } | null> {
  const { data, error } = await core
    .from('conversations')
    .select('title, archived_at')
    .eq('subject_kind', 'ask')
    .eq('subject_ref', ref)
    .maybeSingle();
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the chat failed: ${error.message}`);
  if (!data) return null;
  const row = data as { title: string | null; archived_at: string | null };
  return { title: row.title, archivedAt: row.archived_at };
}
