/**
 * A saved conversation with Dash: a thread under any row in the app (kind
 * `row`, plan #1468), or a question asked from anywhere (kind `ask`, plan
 * #1086). The tables are core.conversations and core.conversation_turns (core
 * migrations 0104, 0109 and 0165), the one thread store of
 * docs/CORE-AND-DASH-SPEC.md Part 2.
 *
 * This file is the shape and the rules that need no database, so the thread
 * component can import it. Reading and writing are in store.ts, the model
 * call in reply.ts.
 */

/**
 * What a conversation can be about.
 *
 * `row` is a thread under one row, and its ref is that row's ref,
 * `schema.table:id` (lib/core/refs.ts). The database refuses a ref that does
 * not name a row of the writer's own (core.refs_check), so a thread can sit
 * under a row of any table with an id and a user_id. A Learn now card's
 * thread is under `learn.feed_cards:<id>`; a newsletter story's is under its
 * saved copy, `news.saved_stories:<id>` (lib/news/quick/discuss.ts).
 *
 * `ask` is a question asked from anywhere: it is about nothing in particular,
 * so its ref is the conversation's own id (the table checks this), and every
 * new question starts one with startAsk in store.ts.
 */
export const SUBJECT_KINDS = ['row', 'ask'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** What a conversation is about, as the table keys it. */
export type TalkSubject = {
  kind: SubjectKind;
  /** For `row`, the row's ref; for `ask`, the conversation's own id. */
  ref: string;
  /** What the subject is called, kept on the conversation when it begins. */
  title?: string | null;
};

/**
 * The thread under one row: `table` is `schema.table` and `id` the row's id,
 * joined as toRef in lib/core/refs.ts joins them. Written out here rather than
 * imported so the thread component does not pull in the sources catalogue.
 */
export function rowSubject(table: string, id: string, title?: string | null): TalkSubject & { kind: 'row' } {
  return { kind: 'row', ref: `${table}:${id}`, title: title ?? null };
}

/** 'user' is the person, 'assistant' is Dash: the roles the model is sent. */
export type TalkRole = 'user' | 'assistant';

/**
 * One lookup Dash made to write a turn (plan #1089): the tool, what it was
 * asked, and what it gave back. Kept so a reopened answer can show its working.
 */
export type TalkToolCall = { name: string; input: unknown; result: unknown };

/**
 * A row a turn cites (plan #1089): which table, which row, and what the page
 * shows and links to. Only rows a tool returned are ever stored.
 */
export type TalkCitation = { table: string; ref: string; title: string; href: string };

export type TalkTurn = {
  id: string;
  role: TalkRole;
  body: string;
  createdAt: string;
  /** Dash's turns in an `ask` conversation only; absent everywhere else. */
  toolCalls?: TalkToolCall[];
  citations?: TalkCitation[];
};

export type TalkTurnRow = {
  id: string;
  role: string;
  body: string;
  created_at: string;
  tool_calls?: TalkToolCall[] | null;
  citations?: TalkCitation[] | null;
};

/** A turn as it is written: Dash's may carry what it looked up and cited. */
export type NewTalkTurn = {
  role: TalkRole;
  body: string;
  toolCalls?: readonly TalkToolCall[];
  citations?: readonly TalkCitation[];
};

/** The longest turn the table takes (conversation_turns_body_ck). */
export const MAX_TURN = 8000;

export const TURN_SELECT = 'id, role, body, created_at, tool_calls, citations';

export function toTalkTurn(row: TalkTurnRow): TalkTurn {
  const turn: TalkTurn = {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    body: row.body,
    createdAt: row.created_at,
  };
  if (Array.isArray(row.tool_calls) && row.tool_calls.length > 0) turn.toolCalls = row.tool_calls;
  if (Array.isArray(row.citations) && row.citations.length > 0) turn.citations = row.citations;
  return turn;
}

/** A question as the title of the conversation it starts: one line, cut at a word. */
export const MAX_ASK_TITLE = 120;
export function askTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  if (line.length <= MAX_ASK_TITLE) return line;
  const cut = line.slice(0, MAX_ASK_TITLE - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_ASK_TITLE / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
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
