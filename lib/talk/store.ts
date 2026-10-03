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
        // Only Dash's turns carry these (conversation_turns_*_ck), and an
        // empty list is stored as nothing.
        ...(turn.role === 'assistant' && turn.toolCalls?.length ? { tool_calls: turn.toolCalls } : {}),
        ...(turn.role === 'assistant' && turn.citations?.length ? { citations: turn.citations } : {}),
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
