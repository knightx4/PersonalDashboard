import type { BotHandoffEnd, BotHandoffResultRow } from '@/lib/talk/bot-handoff';
import type { BotHandoff } from '@/lib/talk/bot-handoffs';
import type { DashChange } from '@/lib/talk/changes';
import type { HandoffReplyOutcome, MentorHandoffTurn } from '@/lib/you/mentor-reply';
import { firstName } from '@/lib/you/group-chats-model';

/**
 * The receiving bot taking up a request another bot passed it (plan
 * #3003.3, under #3003).
 *
 * The person told Zena "tell Bob to build it this way"; Zena said "Passed to
 * Bob." and kept a core.bot_handoffs row (plan #3003.2). Right after, this
 * runs for that row: it takes Bob's one-on-one thread (the typing claim is
 * the lock, as a reply's is), marks the row picked up, writes one line in
 * Bob's thread saying what Zena passed on, and runs Bob's reply with his own
 * tools and rules and the hand-off as the last turn (replyToHandoff in
 * lib/you/mentor-reply.ts). What he changes is kept under that line, so it
 * shows in his thread with its Undo. Then the row is closed: done with what
 * he did and the row he made, or failed with why.
 *
 * When something he needs is unclear, his rules tell him to make no change
 * and ask in his own thread; the row is closed done with what he asked, and
 * the person answers him there as in any chat.
 *
 * This file has no database. lib/you/bot-handoff-reply-request.ts binds the
 * ports to the person's clients.
 */

/** The receiving bot, as its thread needs it. */
export type HandoffBot = { id: string; key: string; name: string; canTalk: boolean };

export type HandoffReplyPorts = {
  /** The hand-off by id, the person's own. */
  load: (id: string) => Promise<BotHandoff | null>;
  /** Someone on People by id; null when they are not there. */
  bot: (id: string) => Promise<HandoffBot | null>;
  /** The bot's one-on-one thread, started when there is none. */
  directChat: (bot: HandoffBot) => Promise<string>;
  /** Takes the thread's typing dots: false while a reply is being written there. */
  claim: (chatId: string) => Promise<boolean>;
  /** Lets go of the dots without a reply. */
  release: (chatId: string) => Promise<void>;
  /** Marks the row picked up; null when another run already did. */
  pickUp: (id: string) => Promise<BotHandoff | null>;
  /** Writes one of the bot's lines in its thread and gives its id and time. */
  say: (chatId: string, text: string) => Promise<{ id: string; createdAt: string }>;
  /** The bot's reply to the hand-off, while the dots are held; releases them. */
  reply: (chatId: string, turn: MentorHandoffTurn) => Promise<HandoffReplyOutcome>;
  /** Closes the row. */
  end: (id: string, end: BotHandoffEnd) => Promise<void>;
  /** Tells the person a reply came when they were not in the thread to read it. Never throws. */
  announce?: (chatId: string, bot: HandoffBot, since: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** How long the run waits for a reply already being written in the receiver's thread. */
export const CLAIM_WAIT_MS = 90_000;
/** How often it tries the thread again in that time. */
export const CLAIM_RETRY_MS = 5_000;

/** The longest stretch of the person's words quoted in the receiver's thread. */
const QUOTE_MAX = 280;

export type HandoffReplyResult =
  | { status: 'done'; result: string; row: BotHandoffResultRow | null; chatId: string }
  | { status: 'failed'; error: string }
  /** Nothing was done: the row is not sent any more, or the thread stayed busy. */
  | { status: 'skipped'; why: string };

/** The person's words, cut for quoting in a text. */
export function quoteRequest(request: string): string {
  const flat = request.replace(/\s+/g, ' ').trim();
  return flat.length <= QUOTE_MAX ? flat : `${flat.slice(0, QUOTE_MAX - 1).trimEnd()}…`;
}

/** The receiver's line in its own thread saying who passed what: the text its changes hang from. */
export function handoffLine(sender: string, request: string): string {
  return `${sender} passed this on to me from your chat: “${quoteRequest(request)}”`;
}

/** The hand-off as the reply's last turn: the person's words, the sender's packet and the link back. */
export function handoffBrief(handoff: Pick<BotHandoff, 'request' | 'packet' | 'sourceKind' | 'sourceLink'>, sender: string): string {
  const { packet } = handoff;
  const where = handoff.sourceKind === 'group' ? `a group chat ${sender} is in` : `their chat with ${sender}`;
  const parts = [
    `[A hand-off from ${sender}, not a text from them. ${sender} passed this on from ${where} (${handoff.sourceLink}).]`,
    `What they said to ${sender}:\n${handoff.request.trim()}`,
  ];
  if (packet.summary) parts.push(`${sender}'s summary of that chat:\n${packet.summary}`);
  if (packet.findings?.length) parts.push(`What ${sender} found:\n${packet.findings.map((line) => `- ${line}`).join('\n')}`);
  if (packet.decisions?.length) parts.push(`What was decided:\n${packet.decisions.map((line) => `- ${line}`).join('\n')}`);
  if (packet.refs?.length) {
    parts.push(`Rows ${sender} pointed at:\n${packet.refs.map((r) => `- ${r.ref}${r.note ? `: ${r.note}` : ''}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** What the receiving bot is told about a hand-off, after its own rules. */
export function handoffRules(sender: string): string {
  return `A REQUEST ${sender.toUpperCase()} PASSED TO YOU. The last turn is not a text from
them: it is something they asked ${sender} to pass to you, with ${sender}'s summary and
findings. Act on it now with your own tools and rules, as if they had asked you
here: make the change it asks for, carrying the detail the hand-off gives (a plan
step gets the whole of what was worked out, not a line). Then text them in your
own voice, in one or two short texts: name ${sender}, say what you did, and give
the row you made, such as "${sender} filled me in on the voice chat update and
I've sent it to be built now: #3010." If something you need to act is unclear or
missing, do not guess and make no change: ask them in one short text here. Never
pass it back to ${sender} or on to anyone else, and never say it is done unless a
tool did it.`;
}

/** The row a hand-off's reply made: the first change written, as schema.table and id. */
export function handoffRow(changes: readonly DashChange[]): BotHandoffResultRow | null {
  for (const change of changes) {
    if (change.status === 'done' && change.writtenTable && change.writtenRef) {
      return { table: change.writtenTable, id: change.writtenRef };
    }
  }
  return null;
}

/** What the receiver did, in a sentence for the log: its changes, or what it texted when it changed nothing. */
export function handoffResult(changes: readonly DashChange[], reply: string): string {
  const said = (change: DashChange) =>
    (change.summary ?? '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '') || change.kind.replace(/_/g, ' ');
  const done = changes.filter((c) => c.status === 'done').map(said);
  const proposed = changes.filter((c) => c.status === 'proposed').map(said);
  const parts = [...(done.length ? [`Made: ${done.join('; ')}`] : []), ...(proposed.length ? [`Proposed: ${proposed.join('; ')}`] : [])];
  if (parts.length) return `${parts.join('. ')}.`;
  const text = reply.replace(/\s+/g, ' ').trim();
  return `Changed nothing and replied: ${text.slice(0, 400) || '(nothing)'}`;
}

/** The sender as the receiver names it: "Zena" for Zena the Researcher, "Dash" for Ask Dash. */
async function senderName(ports: HandoffReplyPorts, fromBot: string | null): Promise<string> {
  if (fromBot === null) return 'Dash';
  const bot = await ports.bot(fromBot);
  return bot ? firstName(bot.name) || bot.name : 'Someone on People';
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Takes up one hand-off for its receiver: claim, pick up, say what was
 * passed, reply with the bot's own tools, close the row. A failure closes
 * it failed with why; a row no longer sent, or a thread busy for
 * CLAIM_WAIT_MS, is left as it is. Never throws.
 */
export async function answerBotHandoff(ports: HandoffReplyPorts, handoffId: string): Promise<HandoffReplyResult> {
  const now = ports.now ?? Date.now;
  const sleep = ports.sleep ?? realSleep;
  const fail = async (error: string): Promise<HandoffReplyResult> => {
    try {
      await ports.end(handoffId, { status: 'failed', error });
    } catch (endError) {
      console.error('a failed bot hand-off could not be closed', endError);
    }
    return { status: 'failed', error };
  };

  let handoff: BotHandoff | null;
  try {
    handoff = await ports.load(handoffId);
  } catch (error) {
    console.error('the bot hand-off was not read', error);
    return { status: 'skipped', why: 'The hand-off could not be read.' };
  }
  if (!handoff || handoff.status !== 'sent') return { status: 'skipped', why: 'The hand-off is not waiting.' };
  if (handoff.toBot === null) return fail('Ask Dash does not take requests from the bots yet.');

  let bot: HandoffBot | null;
  let sender: string;
  let chatId: string;
  try {
    bot = await ports.bot(handoff.toBot);
    if (!bot) return fail('The bot it was passed to is not on People any more.');
    if (!bot.canTalk) return fail(`${bot.name} cannot talk until their brain is built.`);
    sender = await senderName(ports, handoff.fromBot);
    chatId = await ports.directChat(bot);
  } catch (error) {
    console.error('the bot hand-off could not start', error);
    return fail(`${error instanceof Error ? error.message : 'The receiving thread could not be opened.'}`.slice(0, 500));
  }

  // The dots are the lock: wait out a reply already being written there.
  const waitUntil = now() + CLAIM_WAIT_MS;
  let claimed = false;
  for (;;) {
    try {
      claimed = await ports.claim(chatId);
    } catch (error) {
      console.error('the bot hand-off could not take the thread', error);
      return fail('The receiving thread could not be taken.');
    }
    if (claimed || now() >= waitUntil) break;
    await sleep(CLAIM_RETRY_MS);
  }
  if (!claimed) return { status: 'skipped', why: `${bot.name}'s thread stayed busy.` };

  let picked: BotHandoff | null;
  try {
    picked = await ports.pickUp(handoff.id);
  } catch (error) {
    console.error('the bot hand-off could not be picked up', error);
    await ports.release(chatId).catch(() => undefined);
    return { status: 'skipped', why: 'The hand-off could not be picked up.' };
  }
  if (!picked) {
    await ports.release(chatId).catch(() => undefined);
    return { status: 'skipped', why: 'Another run picked it up.' };
  }

  const since = new Date(now()).toISOString();
  let anchor: { id: string; createdAt: string };
  try {
    anchor = await ports.say(chatId, handoffLine(sender, picked.request));
  } catch (error) {
    console.error('the bot hand-off line was not written', error);
    await ports.release(chatId).catch(() => undefined);
    return fail(`${bot.name}'s thread could not be written to.`);
  }

  const outcome = await ports.reply(chatId, { anchor, brief: handoffBrief(picked, sender), rules: handoffRules(sender) });
  if (!outcome.ok) return fail(outcome.error ?? `${bot.name} did not reply.`);

  const result = handoffResult(outcome.changes, outcome.reply);
  const row = handoffRow(outcome.changes);
  try {
    await ports.end(picked.id, { status: 'done', result, row });
  } catch (error) {
    console.error('the bot hand-off was done but not closed', error);
  }
  if (ports.announce) await ports.announce(chatId, bot, since);
  return { status: 'done', result, row, chatId };
}
