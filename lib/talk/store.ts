import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import {
  toTalkTurn,
  TURN_SELECT,
  type SubjectKind,
  type TalkRole,
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
 * Nothing here checks that the subject is yours: the caller reads the card or
 * story through its own module's client first, which RLS has already scoped,
 * and passes the subject on. A conversation naming somebody else's card would
 * hold only what you wrote in it.
 */

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
  turns: readonly { role: TalkRole; body: string }[],
): Promise<TalkTurn[]> {
  if (turns.length === 0) return [];

  // Starting it is a no-op when it exists, so the title it began with stays.
  const { error: startError } = await core.from('conversations').upsert(
    {
      user_id: userId,
      subject_kind: subject.kind,
      subject_ref: subject.ref,
      title: subject.title?.trim() || null,
    },
    { onConflict: 'user_id,subject_kind,subject_ref', ignoreDuplicates: true },
  );
  assertSchemaExposed(startError, CORE_SCHEMA);
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
      })),
    )
    .select(TURN_SELECT);
  if (error) throw new Error(`Keeping that failed: ${error.message}`);
  return ((data ?? []) as TalkTurnRow[]).map(toTalkTurn).sort(byTime);
}
