import type Anthropic from '@anthropic-ai/sdk';
import type { AskToolResult } from '@/lib/ask/db';
import { toRef } from '@/lib/core/refs';
import type { DashHandoffTool } from '@/lib/dash/registry';
import { firstName } from '@/lib/you/group-chats-model';
import {
  normaliseRequest,
  type BotHandoffInput,
  type BotHandoffPacket,
  type BotHandoffRef,
  type BotHandoffSource,
} from './bot-handoff';

/**
 * A bot passing what the person asked to another bot (plan #3003.2).
 *
 * In a one-on-one, a group or Ask Dash, the person says "tell Bob to build
 * it this way" or "hand this to Maya". The bot calls `hand_to_bot` with the
 * name as they said it and what the receiver needs: a summary of the chat,
 * the findings and decisions that matter, the rows to read. The name is
 * matched against the people on People (resolveBot) and the bot is told to
 * ask when it fits nobody or more than one. A match keeps one row in
 * core.bot_handoffs (lib/talk/bot-handoffs.ts keepBotHandoff), with the
 * person's own words as the request and a link back to this thread, and the
 * bot is told to say "Passed to Bob." and nothing more.
 *
 * One row per request: the key is the thread, the receiver and the person's
 * words (botHandoffKey), so the person repeating themselves, a retried turn
 * or a second bot in a group calling it for the same texts gets the row
 * already kept, and the bot is told it was passed already.
 *
 * This file is the part with no database. lib/talk/hand-to-bot-store.ts
 * binds the ports to the person's clients.
 */

export const HAND_TO_BOT_TOOL_NAME = 'hand_to_bot';

/** The longest name, summary and line the tool reads. */
const MAX_NAME = 120;

export const HAND_TO_BOT_TOOL: Anthropic.Tool = {
  name: HAND_TO_BOT_TOOL_NAME,
  description:
    'Pass what the person asked to another bot on People, when they tell you to by name ("tell Bob to build it this way", "hand this to Maya", "send this to Gert"). Their own words go with it, and a link back to this chat; you add what the other bot needs to act without asking. Call it once per request. The other bot does the work with its own tools and answers them in its own chat.',
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'The bot to pass it to, by the name they used: "Bob", "Maya", "Gert", "Dash".' },
      summary: {
        type: 'string',
        description: 'What this chat has covered so far that bears on the request, in a short paragraph the other bot can act on.',
      },
      findings: {
        type: 'array',
        items: { type: 'string' },
        description: 'Each finding that matters, one per line: research, prices, options compared, what was checked.',
      },
      decisions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Each decision already made, one per line: the option they chose, the recommendation taken.',
      },
      refs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'The table a lookup returned it from, as schema.table.' },
            ref: { type: 'string', description: 'Its id, as the lookup returned it.' },
            note: { type: 'string', description: 'Why the other bot should read it.' },
          },
          required: ['table', 'ref'],
          additionalProperties: false,
        },
        description: 'The rows that matter, from your lookups in this chat.',
      },
    },
    required: ['to', 'summary'],
    additionalProperties: false,
  },
};

/** The tool as the Dash loop offers it: a hand-off, sent to the `handOff` hook. */
export const HAND_TO_BOT: DashHandoffTool = { name: HAND_TO_BOT_TOOL_NAME, kind: 'handoff', definition: HAND_TO_BOT_TOOL };

/** What a bot is told about passing requests on, after its own rules. */
export const BOT_HANDOFF_RULES = `YOU CAN PASS A REQUEST TO ANOTHER BOT. When they tell you to pass something
to someone else on People by name ("tell Bob to build it this way", "hand this
to Maya", "send this to Gert"), call hand_to_bot once, with the name as they
said it, a summary of this chat so far, the findings and decisions that matter
for what they asked (research, prices, the option chosen), and the refs of the
rows that matter. When they name someone to pass it to, this is the tool, never
hand_off. Their own words go with it, and a link back here. Of what you
know from your one-on-one chats and memory, put in only what this request
needs. Then reply as the tool says, which is usually "Passed to Bob." and
nothing more. Never do the other bot's part yourself, never say it is done,
and never pass on something they did not ask you to pass on.`;

/** Someone on People a request can go to; `id` null is Ask Dash. */
export type BotEntry = { id: string | null; name: string; key: string | null };

/** Ask Dash, as the bots name it. */
export const ASK_DASH_BOT: BotEntry = { id: null, name: 'Dash', key: null };

const words = (text: string): string => normaliseRequest(text).replace(/^the /, '');

/** The names a bot answers to: its whole name, its first name, its key and what follows "the". */
export function botAliases(bot: BotEntry): string[] {
  if (bot.id === null) return ['dash', 'ask dash'];
  const out = new Set<string>();
  const add = (text: string) => {
    const w = words(text);
    if (w.length >= 2) out.add(w);
  };
  add(bot.name);
  add(firstName(bot.name));
  if (bot.key) add(bot.key.replace(/_/g, ' '));
  const the = / the (.+)$/i.exec(bot.name);
  if (the) add(the[1]);
  return [...out];
}

/** What the bots call someone in a text: "Bob" for Bob Builder. */
export function callName(bot: BotEntry): string {
  return bot.id === null ? 'Dash' : firstName(bot.name) || bot.name;
}

export type BotMatch =
  | { kind: 'one'; bot: BotEntry }
  | { kind: 'unclear'; candidates: BotEntry[] }
  | { kind: 'none' };

/**
 * The bot a name means, among `bots` and Ask Dash. A name that is one of a
 * bot's aliases picks it; failing that, a name whose every word is in one
 * bot's name does. Two or more matches are unclear, and none is none.
 */
export function resolveBot(named: string, bots: readonly BotEntry[]): BotMatch {
  const want = words(named);
  if (!want) return { kind: 'none' };
  const all = [ASK_DASH_BOT, ...bots];
  const exact = all.filter((bot) => botAliases(bot).includes(want));
  if (exact.length === 1) return { kind: 'one', bot: exact[0] };
  if (exact.length > 1) return { kind: 'unclear', candidates: exact };
  const parts = want.split(' ');
  const loose = bots.filter((bot) => {
    const have = new Set(words(bot.name).split(' '));
    return parts.every((part) => have.has(part));
  });
  if (loose.length === 1) return { kind: 'one', bot: loose[0] };
  if (loose.length > 1) return { kind: 'unclear', candidates: loose };
  return { kind: 'none' };
}

/**
 * The person's texts in the turn being answered, as one request: each in
 * order, a text repeated word for word kept once, so "tell Bob" sent twice
 * in a row is the same request as sent once.
 */
export function personWords(texts: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    const trimmed = text.trim();
    const key = normaliseRequest(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.join('\n');
}

/** Who is passing it on, from which thread, answering which of the person's texts. */
export type BotPassAsker = {
  /** The sending bot (you.board_advisors id); null is Ask Dash. */
  fromBot: string | null;
  source: BotHandoffSource;
  /** The newest of the person's texts being answered, when known. */
  messageId: string | null;
  /** The person's own words in this turn (personWords). */
  asked: string;
};

/** What the model's call asks for, read. */
export type BotPassRequest = { to: string; packet: BotHandoffPacket };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const lines = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/**
 * The tool's input, or why it cannot be used. Refs a lookup in this chat
 * did not return are dropped, so the receiver is never pointed at a
 * made-up row.
 */
export function botPassRequest(
  input: unknown,
  seen: (table: string, ref: string) => boolean = () => false,
): ({ ok: true } & BotPassRequest) | { ok: false; error: string } {
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const to = text(args.to).slice(0, MAX_NAME);
  if (!to) return { ok: false, error: 'to is missing: the name of the bot to pass it to, as they said it.' };
  const refs: BotHandoffRef[] = [];
  for (const item of Array.isArray(args.refs) ? args.refs : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const table = text(row.table);
    const ref = text(row.ref);
    if (!TABLE.test(table) || !ref || !seen(table, ref)) continue;
    const note = text(row.note);
    refs.push(note ? { ref: toRef(table, ref), note } : { ref: toRef(table, ref) });
  }
  const packet: BotHandoffPacket = {};
  const summary = text(args.summary);
  if (summary) packet.summary = summary;
  const findings = lines(args.findings);
  if (findings.length) packet.findings = findings;
  const decisions = lines(args.decisions);
  if (decisions.length) packet.decisions = decisions;
  if (refs.length) packet.refs = refs;
  return { ok: true, to, packet };
}

/** The core.bot_handoffs input for a call that named one bot. */
export function botPassInput(asker: BotPassAsker, to: BotEntry, packet: BotHandoffPacket): BotHandoffInput {
  return {
    fromBot: asker.fromBot,
    toBot: to.id,
    source: asker.source,
    sourceMessageId: asker.messageId,
    request: asker.asked,
    packet,
  };
}

export type BotPassPorts = {
  /** The people on People a request can go to, active ones only. */
  bots: () => Promise<BotEntry[]>;
  /** Keeps the row once per request (keepBotHandoff). */
  keep: (input: BotHandoffInput) => Promise<{ ok: true; handoff: { id: string }; created: boolean } | { ok: false; error: string }>;
};

/** Passes one call on for the bot in `asker`; what a reply's tool call runs (lib/talk/hand-to-bot-store.ts). */
export type BotPasser = (
  asker: BotPassAsker,
  input: unknown,
  seen?: (table: string, ref: string) => boolean,
) => Promise<AskToolResult>;

/** Said to the model once the row is kept. */
export function passedNote(name: string): string {
  return `Passed on. Reply with exactly "Passed to ${name}." and nothing more, unless they asked something else in the same text that you still have to answer. ${name} does it and answers them in ${name}'s own chat. Do not do it here and do not say it is done.`;
}

/** Said to the model when the same request was passed on before. */
export function alreadyPassedNote(name: string): string {
  return `This was already passed to ${name}, so nothing new was sent: one hand-off per request. Do not say "Passed to ${name}." again. Say in a few words that ${name} already has it, then carry on.`;
}

/** Said to the model when the name fits more than one bot. */
export function unclearNote(named: string, candidates: readonly BotEntry[]): string {
  const names = candidates.map((bot) => bot.name);
  const list = names.length === 2 ? `${names[0]} or ${names[1]}` : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Nothing was passed on: "${named}" could be ${list}. Ask them in one short text which one they mean, and pass it on once they say.`;
}

/** Said to the model when the name fits nobody. */
export function noBotNote(named: string, bots: readonly BotEntry[]): string {
  const names = [ASK_DASH_BOT, ...bots].map((bot) => bot.name).join(', ');
  return `Nothing was passed on: nobody on People is called "${named}". They can pass things to ${names}. Ask them in one short text who they mean.`;
}

/** Said to the model when the name is its own. */
export function selfNote(name: string): string {
  return `Nothing was passed on: that is you, ${name}. Do it yourself with your own tools, or ask them who they meant.`;
}

/** Said to the model when the row could not be kept. */
export function notPassedNote(why: string): string {
  return `It was not passed on: ${why} Say so plainly in a short text, in your own voice. Do not say it was passed on, and do not ask them to try again.`;
}

/**
 * One hand-off to a bot: read the call, find the bot, keep the row, and say
 * what the sending bot is told. Never throws: a failure comes back as what
 * to tell the person.
 */
export async function passToBot(
  ports: BotPassPorts,
  asker: BotPassAsker,
  input: unknown,
  seen?: (table: string, ref: string) => boolean,
): Promise<AskToolResult> {
  const parsed = botPassRequest(input, seen);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  let bots: BotEntry[];
  try {
    bots = await ports.bots();
  } catch (error) {
    console.error('the bots to pass to were not read', error);
    return { ok: true, rows: [], note: notPassedNote('the people on People could not be read.') };
  }
  const match = resolveBot(parsed.to, bots);
  if (match.kind === 'none') return { ok: true, rows: [], note: noBotNote(parsed.to, bots) };
  if (match.kind === 'unclear') return { ok: true, rows: [], note: unclearNote(parsed.to, match.candidates) };
  const to = match.bot;
  if (to.id === asker.fromBot) return { ok: true, rows: [], note: selfNote(callName(to)) };
  let kept: Awaited<ReturnType<BotPassPorts['keep']>>;
  try {
    kept = await ports.keep(botPassInput(asker, to, parsed.packet));
  } catch (error) {
    console.error('the hand-off to a bot was not kept', error);
    return { ok: true, rows: [], note: notPassedNote('the request could not be saved.') };
  }
  if (!kept.ok) return { ok: true, rows: [], note: notPassedNote(kept.error) };
  const name = callName(to);
  return {
    ok: true,
    rows: [],
    totals: { handoff: kept.handoff.id, to: to.name },
    note: kept.created ? passedNote(name) : alreadyPassedNote(name),
  };
}
