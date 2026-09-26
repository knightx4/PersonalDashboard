/**
 * A saved conversation with Dash about something you are reading (plan
 * #1053): a Learn now card, and later a news story. The tables are
 * core.conversations and core.conversation_turns (core migration 0104).
 *
 * This file is the shape and the rules that need no database, so the thread
 * component can import it. Reading and writing are in store.ts, the model
 * call in reply.ts.
 */

/**
 * What a conversation can be about. `news_story` is allowed by the table and
 * left for the News feature to use: a story's ref format is its to choose,
 * because a story is a position in an array that re-summarising rewrites.
 */
export const SUBJECT_KINDS = ['feed_card', 'news_story'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** What a conversation is about, as the table keys it. */
export type TalkSubject = {
  kind: SubjectKind;
  /** For `feed_card`, the learn.feed_cards id. */
  ref: string;
  /** What the subject is called, kept on the conversation when it begins. */
  title?: string | null;
};

/** 'user' is the person, 'assistant' is Dash: the roles the model is sent. */
export type TalkRole = 'user' | 'assistant';

export type TalkTurn = {
  id: string;
  role: TalkRole;
  body: string;
  createdAt: string;
};

export type TalkTurnRow = {
  id: string;
  role: string;
  body: string;
  created_at: string;
};

/** The longest turn the table takes (conversation_turns_body_ck). */
export const MAX_TURN = 8000;

export const TURN_SELECT = 'id, role, body, created_at';

export function toTalkTurn(row: TalkTurnRow): TalkTurn {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    body: row.body,
    createdAt: row.created_at,
  };
}

/** A turn's text, trimmed and checked against the table's limits. */
export function turnBody(raw: string): { body: string } | { error: string } {
  const body = raw.trim();
  if (!body) return { error: 'Write something first.' };
  if (body.length > MAX_TURN) {
    return { error: `That is ${body.length} characters; the most is ${MAX_TURN}.` };
  }
  return { body };
}

/**
 * The turns as the model is sent them.
 *
 * The API wants the messages to start with the person and alternate. A saved
 * thread can break both: a reply that failed leaves two of the person's turns
 * in a row, and a conversation Dash opened (a teach-back prompt, #1054) starts
 * with Dash. Runs of one role are joined into one message, and anything Dash
 * said before the person's first turn goes ahead of it, marked as Dash's.
 */
export function toModelMessages(
  turns: readonly Pick<TalkTurn, 'role' | 'body'>[],
): { role: TalkRole; content: string }[] {
  const messages: { role: TalkRole; content: string }[] = [];
  const opening: string[] = [];
  for (const turn of turns) {
    const body = turn.body.trim();
    if (!body) continue;
    if (messages.length === 0 && turn.role === 'assistant') {
      opening.push(body);
      continue;
    }
    const last = messages[messages.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${body}`;
    else messages.push({ role: turn.role, content: body });
  }
  if (opening.length > 0 && messages.length > 0) {
    messages[0].content = `(Dash said earlier: ${opening.join('\n\n')})\n\n${messages[0].content}`;
  }
  return messages;
}
