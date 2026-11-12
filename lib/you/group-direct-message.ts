import type Anthropic from '@anthropic-ai/sdk';
import type { CouncilReceipt } from '@/lib/you/council-model';
import { firstName } from '@/lib/you/group-chats-model';
import { threadHref } from '@/lib/you/chat-threads-model';

/**
 * A bot in a group messaging the person in its own one-on-one chat, when
 * they ask it to (plan #3083).
 *
 * In a group the person writes "Richard, can you message me individually
 * about the Cornell cafeteria". Richard's turn calls
 * `message_person_directly` with what they want from him and a short
 * summary of the group exchange. That runs his one-on-one reply there and
 * then: his thread is taken (the typing claim is the lock, as a reply's
 * is), a line naming the group goes in with a link back to it, and his
 * reply follows with his own persona, memory and tools, the request as the
 * last turn (replyToHandoff in lib/you/mentor-reply.ts). The person is told
 * of it as of any reply they have not read. Richard is then told it was
 * sent, and his text in the group is one short line pointing at the chat,
 * with a link to it under the text; it is cut back to that line when he
 * writes more. When it could not be sent he is told why and says so.
 *
 * This file has no database. lib/you/group-direct-message-request.ts binds
 * the ports to the person's clients.
 */

export const DIRECT_MESSAGE_TOOL_NAME = 'message_person_directly';

export const DIRECT_MESSAGE_TOOL: Anthropic.Tool = {
  name: DIRECT_MESSAGE_TOOL_NAME,
  description:
    'Message the person in your own one-on-one chat with them, when they ask you to ("message me individually", "DM me", "tell me privately", "text me about it"). Your one-on-one self writes the message there in full; here you then post one short line pointing at it. Call it once, only when they asked you.',
  input_schema: {
    type: 'object',
    properties: {
      ask: {
        type: 'string',
        description: 'What they want from you in that chat, in their terms: "the full story of your Cornell cafeteria situation".',
      },
      summary: {
        type: 'string',
        description: 'Two or three sentences on the group exchange that led to it: what was being talked about and what you had said.',
      },
    },
    required: ['ask'],
    additionalProperties: false,
  },
};

/** What a speaker in a group is told about the tool, after the texting rules. */
export const DIRECT_RULES = `When the person asks you to message them individually, privately or in your own chat ("DM me", "tell me privately"), call ${DIRECT_MESSAGE_TOOL_NAME} once. It writes the message in your one-on-one chat with them. Then your text here is one short line saying you sent it, such as "Sent you the full story in our chat", and nothing of what you sent. Never tell them to ask you there instead, and never say you sent something unless the tool says it was sent.`;

/** Told to a bot the person asked by name to message them directly. */
export const DIRECT_ASKED_RULES = `They asked you to message them in your own chat: call ${DIRECT_MESSAGE_TOOL_NAME} now, before you write anything here.`;

/** How many of the group's newest lines go with the request to the one-on-one chat. */
export const DIRECT_TRANSCRIPT_LINES = 8;
/** The longest a bot's pointer line in the group runs before it is cut back to the plain one. */
export const POINTER_MAX = 160;
/** The longest wait for a reply already being written in the bot's own chat. */
export const DIRECT_CLAIM_WAIT_MS = 20_000;
/** How often the chat is tried again in that time. */
export const DIRECT_CLAIM_RETRY_MS = 2_000;
const QUOTE_MAX = 280;
const ASK_MAX = 1_000;
const SUMMARY_MAX = 2_000;

const DIRECT_WORDS = new RegExp(
  [
    String.raw`\b(?:dm|direct message|private message)\b`,
    String.raw`\bpm\s+me\b`,
    String.raw`\b(?:message|text|write|ping|tell|send|msg)\s+me\s+(?:\S+\s+){0,6}?(?:individually|privately|directly|separately|personally|one[- ]on[- ]one|1[:-]1|in private|on my own|alone)\b`,
    String.raw`\b(?:individually|privately|separately|one[- ]on[- ]one|in private)\s+(?:message|text|tell|send|write)\b`,
    String.raw`\bin (?:our|your) (?:own )?(?:chat|thread|dms?|one[- ]on[- ]one)\b`,
  ].join('|'),
  'i',
);

/** Whether the person's words ask a bot to message them in its own chat. */
export function wantsDirect(text: string): boolean {
  return DIRECT_WORDS.test(text);
}

/**
 * The bots told they were asked to message the person directly: those the
 * message names, or every member when it speaks to everyone; none when it
 * asks no bot to. A bot not on the list still has the tool.
 */
export function askedDirect(text: string, ask: { named: readonly string[]; everyone: boolean }, memberIds: readonly string[]): string[] {
  if (!wantsDirect(text)) return [];
  if (ask.named.length > 0) return [...ask.named];
  return ask.everyone ? [...memberIds] : [];
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export type DirectRequest = { ask: string; summary: string | null };

/** The tool's input, or why it cannot be used. */
export function directRequestOf(input: unknown): ({ ok: true } & DirectRequest) | { ok: false; error: string } {
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const ask = cut(str(args.ask), ASK_MAX);
  if (!ask) return { ok: false, error: 'ask is missing: what they want from you in your own chat.' };
  const summary = cut(str(args.summary), SUMMARY_MAX) || null;
  return { ok: true, ask, summary };
}

/** Where a group is. */
export function groupHref(chatId: string): string {
  return `/chat/groups/${chatId}`;
}

/** The bot's first line in its own chat, naming the group and what they asked: the text its reply hangs from. */
export function directAnchorLine(groupTitle: string, said: string): string {
  return `You asked me in ${groupTitle} to message you here: “${cut(flat(said), QUOTE_MAX)}”`;
}

/** The link back to the group, under that line. */
export function groupReceipt(groupTitle: string, chatId: string): CouncilReceipt {
  return { label: `Back to ${groupTitle}`, link: groupHref(chatId) };
}

/** The link to the bot's own chat, under its pointer line in the group. */
export function directReceipt(bot: { key: string; name: string }): CouncilReceipt {
  return { label: `Open your chat with ${firstName(bot.name) || bot.name}`, link: threadHref(bot.key) };
}

/** The request as the one-on-one reply's last turn. */
export function directBrief(input: { groupTitle: string; chatId: string; said: string; transcript: string; request: DirectRequest }): string {
  const parts = [
    `[Not a text from them. In the group chat ${input.groupTitle} (${groupHref(input.chatId)}) they asked you to message them here.]`,
    `What they wrote in the group:\n${input.said.trim()}`,
    `What they want from you here:\n${input.request.ask}`,
  ];
  if (input.request.summary) parts.push(`Your summary of the group exchange:\n${input.request.summary}`);
  if (input.transcript.trim()) parts.push(`The group's last few texts, oldest first:\n${input.transcript.trim()}`);
  return parts.join('\n\n');
}

/** What the bot is told in its own chat, after its own rules. */
export function directRules(groupTitle: string): string {
  return `THEY ASKED YOU IN A GROUP TO MESSAGE THEM HERE. The last turn is not a text
from them: in the group chat ${groupTitle} they asked you to message them in
this one-on-one chat. Do it now, in full, in your own voice: tell the whole
story, give the full take or answer the question, as texts in this chat. Do not
tell them to ask you here, since they already have, and do not talk about the
group or about being asked to write. If something you need is unclear, ask
them in one short text here.`;
}

/** Said to the bot in the group once the message is in its chat. */
export function sentNote(name: string): string {
  return `Sent: your message is in your one-on-one chat with them, and a link to it goes under your text here. Write one short line saying you sent it, such as "Sent you the full story in our chat", and nothing of what you sent. Answer anything else they asked you here. Do not call ${DIRECT_MESSAGE_TOOL_NAME} again; ${name}'s chat has it.`;
}

/** Said when it was sent already for this message of theirs. */
export const ALREADY_SENT_NOTE = 'Already sent: your message is in your own chat with them. Do not send it again; write one short line saying it is there.';

/** Said when it could not be sent. */
export function notSentNote(why: string): string {
  return `It was not sent: ${why} Say so plainly in your text here, in your own voice, and do not say you sent it. You may give them the short version here instead.`;
}

/** The bot's text in the group after its message was sent: its own line when short, else the plain one. */
export function pointerText(text: string | null): string {
  const t = (text ?? '').trim();
  if (t && t.length <= POINTER_MAX && !/\n\s*\n/.test(t)) return t;
  return 'Sent you the full thing in our chat.';
}

/** The bot whose chat it is, as the ports need it. */
export type DirectBot = { id: string; key: string; name: string };

/** Who asked for the message, from which group, answering what. */
export type DirectAsker = {
  bot: DirectBot;
  chatId: string;
  groupTitle: string;
  /** The person's texts in the turn being answered. */
  said: string;
  /** The group's last few lines as a transcript. */
  transcript: string;
};

export type DirectOutcome = { ok: true; directChatId: string } | { ok: false; error: string };

/** Sends one message for a bot in a group; what its tool call runs (lib/you/group-direct-message-request.ts). */
export type DirectMessenger = (asker: DirectAsker, input: unknown) => Promise<DirectOutcome>;

export type DirectPorts = {
  /** The bot's one-on-one thread, started when there is none. */
  directChat: (bot: DirectBot) => Promise<string>;
  /** Takes the thread's typing dots: false while a reply is being written there. */
  claim: (chatId: string) => Promise<boolean>;
  /** Lets go of the dots without a reply. */
  release: (chatId: string) => Promise<void>;
  /** Writes one of the bot's lines in its thread, with links under it, and gives its id and time. */
  say: (chatId: string, text: string, receipts: CouncilReceipt[]) => Promise<{ id: string; createdAt: string }>;
  /** The bot's reply with the request as its last turn, while the dots are held; releases them. */
  reply: (chatId: string, turn: { anchor: { id: string; createdAt: string }; brief: string; rules: string }) => Promise<{ ok: boolean; error: string | null; reply: string }>;
  /** Tells the person a reply came when they were not in the thread to read it. Never throws. */
  announce?: (chatId: string, bot: DirectBot, since: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Writes the bot's message in its own chat: take the thread, write the line
 * naming the group, run the reply, tell the person. Never throws: a failure
 * comes back as the sentence the bot says in the group.
 */
export async function sendDirect(ports: DirectPorts, asker: DirectAsker, input: unknown): Promise<DirectOutcome> {
  const now = ports.now ?? Date.now;
  const sleep = ports.sleep ?? realSleep;
  const request = directRequestOf(input);
  if (!request.ok) return { ok: false, error: request.error };
  const name = firstName(asker.bot.name) || asker.bot.name;

  let directChatId: string;
  try {
    directChatId = await ports.directChat(asker.bot);
  } catch (error) {
    console.error('the one-on-one chat for a group message was not opened', error);
    return { ok: false, error: `your chat with them could not be opened.` };
  }

  const waitUntil = now() + DIRECT_CLAIM_WAIT_MS;
  let claimed = false;
  for (;;) {
    try {
      claimed = await ports.claim(directChatId);
    } catch (error) {
      console.error('the one-on-one chat for a group message could not be taken', error);
      return { ok: false, error: 'your chat with them could not be written to.' };
    }
    if (claimed || now() >= waitUntil) break;
    await sleep(DIRECT_CLAIM_RETRY_MS);
  }
  if (!claimed) return { ok: false, error: `a reply of ${name}'s was still being written in that chat.` };

  const since = new Date(now()).toISOString();
  let anchor: { id: string; createdAt: string };
  try {
    anchor = await ports.say(directChatId, directAnchorLine(asker.groupTitle, asker.said), [groupReceipt(asker.groupTitle, asker.chatId)]);
  } catch (error) {
    console.error('the line naming the group was not written', error);
    await ports.release(directChatId).catch(() => undefined);
    return { ok: false, error: 'your chat with them could not be written to.' };
  }

  const outcome = await ports.reply(directChatId, {
    anchor,
    brief: directBrief({ groupTitle: asker.groupTitle, chatId: asker.chatId, said: asker.said, transcript: asker.transcript, request }),
    rules: directRules(asker.groupTitle),
  });
  if (!outcome.ok || !outcome.reply.trim()) {
    return { ok: false, error: outcome.error ? 'the message failed while it was being written.' : 'nothing was written in that chat.' };
  }
  ports.announce?.(directChatId, asker.bot, since);
  return { ok: true, directChatId };
}
