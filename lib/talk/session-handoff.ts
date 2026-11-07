import type { AskToolResult } from '@/lib/ask/db';
import { toRef } from '@/lib/core/refs';
import type { DashHandoffTool } from '@/lib/dash/registry';
import {
  HAND_OFF_TOOL,
  HAND_OFF_TOOL_NAME,
  handoffRequest,
  handoffThreadRef,
  MAX_HANDOFF_REFS,
  type HandoffRef,
  type HandoffThread,
  type SessionHandoffInput,
} from './handoff';

/**
 * The one hand-to-a-session action every bot calls (plan #3005.2).
 *
 * A reply in a chat runs on a tight budget, so long work done inside one is
 * cut short. Every bot (Ask Dash, and each person on People: Gert, Zena,
 * Jerwyn, Maya, the builder, the council members and guests, in a
 * one-on-one or a group) is offered the same `hand_off` tool
 * (HAND_OFF_TOOL, lib/talk/handoff.ts). Calling it keeps the request in
 * core.dash_handoffs as a `session` row (keepSessionHandoff), with the
 * person's own words, the bot's version of the request, a summary of the
 * thread, the rows that matter, who sent it and the thread it came from,
 * and starts a session on it only when the row is new. The bot is then told
 * to say it is on it, in its own voice, and carry on.
 *
 * One row per request: the key is the thread and the person's message
 * (handoffKey), so a retried turn gets the row already kept and starts no
 * second session, and the bot still says it is on it.
 *
 * This file is the part with no database: reading the tool's input, the
 * rules each bot is given, and the steps of one hand-off behind ports.
 * lib/talk/session-handoff-store.ts binds the ports to the person's client
 * and the routine.
 */

/** Who handed it on, in which thread, answering which message of the person's. */
export type SessionAsker = {
  thread: HandoffThread;
  /** The person's message (or Ask turn) being answered: one hand-off per message. */
  messageId: string;
  /** The person's own words in that message. */
  asked: string;
  /** The bot's name as the person reads it: "Gert", "Ask Dash". */
  botName: string;
  /** Where the thread opens in the app. */
  href: string;
};

/** What the model's call asks for, read and checked. */
export type SessionRequest = {
  request: string;
  summary: string | null;
  refs: HandoffRef[];
  subjectRef: string | null;
  /** The bot marked it as needing a web browser (plan #3040.1). */
  browserTask: boolean;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/**
 * The tool's input, or why it cannot be used. The request and the row it is
 * about are read as Ask's hand-off reads them (handoffRequest), so a post is
 * refused and an unseen subject is left out. Refs a lookup did not return
 * are dropped too, so the session is never pointed at a made-up row.
 */
export function sessionRequest(
  input: unknown,
  seen: (table: string, ref: string) => boolean = () => false,
): ({ ok: true } & SessionRequest) | { ok: false; error: string } {
  const parsed = handoffRequest(input, seen);
  if (!parsed.ok) return parsed;
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const summary = text(args.summary);
  const refs: HandoffRef[] = [];
  for (const item of Array.isArray(args.refs) ? args.refs : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const table = text(row.table);
    const ref = text(row.ref);
    if (!TABLE.test(table) || !ref || !seen(table, ref)) continue;
    const note = text(row.note);
    refs.push(note ? { ref: toRef(table, ref), note } : { ref: toRef(table, ref) });
  }
  return {
    ok: true,
    request: parsed.request,
    summary: summary || null,
    refs,
    subjectRef: parsed.subjectRef,
    browserTask: args.browser === true,
  };
}

/**
 * The row's input: the request as read, with the thread itself first among
 * the refs, naming the bot and where the thread opens, so the session can
 * read it and link back to it.
 */
export function sessionHandoffInput(asker: SessionAsker, request: SessionRequest): SessionHandoffInput {
  const thread: HandoffRef = {
    ref: handoffThreadRef(asker.thread),
    note: `The thread this was asked in, with ${asker.botName}: ${asker.href}`,
  };
  return {
    thread: asker.thread,
    messageId: asker.messageId,
    request: request.request,
    asked: asker.asked,
    summary: request.summary,
    refs: [thread, ...request.refs.filter((r) => r.ref !== thread.ref)].slice(0, MAX_HANDOFF_REFS),
    subjectRef: request.subjectRef,
    browserTask: request.browserTask,
  };
}

/** A hand-off as kept: its id, and whether this call made it. */
export type KeptSession = { id: string };

/** Hands one call on for the bot in `asker`; what a reply's tool call runs (lib/talk/session-handoff-store.ts). */
export type SessionStarter = (
  asker: SessionAsker,
  input: unknown,
  seen?: (table: string, ref: string) => boolean,
) => Promise<AskToolResult>;

/** The shared tool as the Dash loop offers it to a bot: a hand-off, sent to the `handOff` hook. */
export const HAND_OFF: DashHandoffTool = { name: HAND_OFF_TOOL_NAME, kind: 'handoff', definition: HAND_OFF_TOOL };

export type SessionHandoffPorts<H extends KeptSession = KeptSession> = {
  /** Keeps the row once per request (keepSessionHandoff). */
  keep: (input: SessionHandoffInput) => Promise<{ ok: true; handoff: H; created: boolean } | { ok: false; error: string }>;
  /**
   * Starts a session on a row this call made. Absent: the row is kept and
   * started later by the caller (Ask Dash starts its hand-offs once its
   * answer is kept). Never called for a row kept before.
   */
  launch?: (handoff: H, asker: SessionAsker) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/** Said to the model once the work is handed on, or was already. */
export const ON_IT =
  'Handed on. Say in one short text, in your own voice, that you are on it (something like "OK, I\'m on it") and that what comes of it will show up here. Then carry on with the conversation as normal. Do not do the work in this reply, and do not say it is done.';

/**
 * Said to the model when this message of theirs was handed on before: by a
 * retried turn, by another call in this reply, or by another bot in a group.
 * Nothing new is started.
 */
export const ON_IT_ALREADY =
  'This message of theirs was already handed on, so nothing new was started: one hand-off per message, and anything that call did not include was not passed on. Say in one short text, in your own voice, that you are on it, then carry on. Do not say it is done.';

/** Said to the model when the request could not be passed on, with the reason. */
export function notHandedOn(why: string): string {
  return `It was not passed on: ${why} Say so plainly in a short text, in your own voice. Do not say it is being worked on, and do not ask them to try again.`;
}

/** What one hand-off came to: what the bot is told, and the row when one was kept. */
export type SessionHandedOn<H extends KeptSession> = {
  told: AskToolResult;
  kept: { handoff: H; created: boolean } | null;
};

/**
 * One hand-off: read the call, keep the row, start a session when the row
 * is new, and say what the bot is told. Never throws: a failure comes back
 * as what to tell the person.
 */
export async function startSessionHandoff<H extends KeptSession>(
  ports: SessionHandoffPorts<H>,
  asker: SessionAsker,
  input: unknown,
  seen?: (table: string, ref: string) => boolean,
): Promise<SessionHandedOn<H>> {
  const parsed = sessionRequest(input, seen);
  if (!parsed.ok) return { told: { ok: false, error: parsed.error }, kept: null };
  let kept: Awaited<ReturnType<SessionHandoffPorts<H>['keep']>>;
  try {
    kept = await ports.keep(sessionHandoffInput(asker, parsed));
  } catch (error) {
    console.error('the hand-off was not kept', error);
    return { told: { ok: true, rows: [], note: notHandedOn('the request could not be saved.') }, kept: null };
  }
  if (!kept.ok) return { told: { ok: false, error: kept.error }, kept: null };
  const result = { handoff: kept.handoff, created: kept.created };
  if (kept.created && ports.launch) {
    let started: { ok: true } | { ok: false; error: string };
    try {
      started = await ports.launch(kept.handoff, asker);
    } catch (error) {
      started = { ok: false, error: error instanceof Error ? error.message : 'the session could not be reached.' };
    }
    if (!started.ok) {
      return { told: { ok: true, rows: [], note: notHandedOn('the session that does it would not start.') }, kept: result };
    }
  }
  return { told: { ok: true, rows: [], note: kept.created ? ON_IT : ON_IT_ALREADY }, kept: result };
}

/**
 * What a bot on People is told about handing on, after its own rules. Ask
 * Dash has the same in its own rules ("ANYTHING ELSE THEY ASK YOU TO DO,
 * HAND ON", lib/dash/ask.ts).
 */
export const SESSION_RULES = `YOU CAN HAND HEAVY WORK TO A SESSION. A reply here is a quick text with
little room. When they ask for something that needs more than that, call
hand_off: long writing (a plan step with its full detail, a vault note, a prep
doc, a cover letter), building something (a practice page, a drill), research,
changes across many rows, or anything your other tools cannot do. Write the
request out in full with every detail they gave, a short summary of this chat
so far, and the refs of the rows that matter. A Claude Code session does it,
and what it made comes back in this thread. Do the same as soon as you see
this turn will not fit what they asked: hand it on rather than stop part-way.
Once it is handed on, say in one short text, in your own voice, that you are
on it, then carry on talking as normal. Never say it is done, never write the
work out here instead, and never end a reply by asking them to try again or
to say it again. Never hand on a question you can answer by looking things up,
and never a request to delete something, send an email or spend money.`;
