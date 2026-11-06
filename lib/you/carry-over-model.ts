import { whenDate, zoneClock } from '@/lib/core/when';
import { cutToTokens, estimateTokens } from '@/lib/you/chat-context-model';
import { groupTitleOf } from '@/lib/you/group-chats-model';

/**
 * What a bot heard in its other chats and has not yet folded into its memory
 * (plan #2983), apart from the reads in carry-over.ts so it can be tested
 * without a database.
 *
 * The overnight run (.claude/skills/board/council.md) summarises each closed
 * conversation into you.advisor_episodes and rewrites the bot's memory from
 * it. Until then, what was said in one chat is unknown in the others. So
 * each reply, direct or group, also reads the bot's other threads: its own
 * one-on-ones with the person and the groups it is in, the messages no
 * summarised episode covers yet, newest first, within CARRY_MAX_MESSAGES and
 * CARRY_TOKENS. Once the nightly run summarises an episode its messages drop
 * out, because the memory page now holds them. No model call is added: the
 * cost is the extra input on the reply that was being made anyway.
 *
 * A group's messages count only while the bot was a member. Another bot's
 * one-on-one is never read, since only the bot's own direct chats are.
 */

/** The most messages carried across threads into one reply. */
export const CARRY_MAX_MESSAGES = 30;
/** The most tokens they may take, heading and rules included. */
export const CARRY_TOKENS = 3_000;
/** One carried message longer than this is cut. */
export const CARRY_MESSAGE_TOKENS = 300;
/** How many of each bot's newest messages are read before the summaries filter them. */
export const CARRY_READ = 60;

/** One of the bot's other threads: a one-on-one of its own, or a group with its membership span. */
export type CarryChat =
  | { id: string; kind: 'direct' }
  | { id: string; kind: 'group'; title: string | null; memberNames: string[]; joinedAt: string; leftAt: string | null };

export type CarryMessage = {
  id: string;
  chatId: string;
  role: 'person' | 'advisor';
  /** In a group, the bot that wrote it; null for the person's and a direct chat's. */
  speakerId: string | null;
  text: string;
  createdAt: string;
};

/** A summarised episode: the messages it spans, up to when it was summarised, are in memory. */
export type CarryEpisode = { chatId: string; startedAt: string; endedAt: string; summarisedAt: string | null };

export type CarryInput = {
  /** The bot replying. */
  advisorId: string;
  /** The thread being replied in, whose own messages the reply already reads. */
  chatId: string;
  chats: readonly CarryChat[];
  messages: readonly CarryMessage[];
  episodes: readonly CarryEpisode[];
  /** Bot names by id, for who said what in a group. */
  names: ReadonlyMap<string, string>;
};

export type CarriedLine = CarryMessage & { label: string; who: string };

const ms = (at: string) => Date.parse(at);

/** Whether a summarised episode of the message's chat already holds it. */
function summarised(m: CarryMessage, episodes: readonly CarryEpisode[]): boolean {
  const at = ms(m.createdAt);
  return episodes.some(
    (e) =>
      e.chatId === m.chatId &&
      ms(e.startedAt) <= at &&
      at <= ms(e.endedAt) &&
      (e.summarisedAt === null || at <= ms(e.summarisedAt)),
  );
}

/** Which chat a message came from, as the bot is told it. */
export function chatLabel(chat: CarryChat): string {
  return chat.kind === 'direct' ? 'one-on-one with them' : `group: ${groupTitleOf(chat.title, chat.memberNames)}`;
}

/**
 * The messages carried into this reply, newest first: from the bot's other
 * threads, while it was in them, not yet summarised, within the caps.
 */
export function carriedLines(input: CarryInput): CarriedLine[] {
  const chats = new Map(input.chats.filter((c) => c.id !== input.chatId).map((c) => [c.id, c] as const));
  const candidates = input.messages
    .filter((m) => {
      const chat = chats.get(m.chatId);
      if (!chat || !m.text.trim() || !Number.isFinite(ms(m.createdAt))) return false;
      if (chat.kind === 'group') {
        const at = ms(m.createdAt);
        if (at < ms(chat.joinedAt) || (chat.leftAt !== null && at > ms(chat.leftAt))) return false;
      }
      return !summarised(m, input.episodes);
    })
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt) || b.id.localeCompare(a.id));

  const out: CarriedLine[] = [];
  let used = estimateTokens(CARRY_HEADING) + estimateTokens(CARRY_RULES_GROUP) + 2;
  for (const m of candidates) {
    if (out.length >= CARRY_MAX_MESSAGES) break;
    const chat = chats.get(m.chatId)!;
    const text = cutToTokens(m.text.trim(), CARRY_MESSAGE_TOKENS);
    const who =
      m.role === 'person'
        ? 'They'
        : chat.kind === 'direct' || m.speakerId === input.advisorId
          ? 'You'
          : input.names.get(m.speakerId ?? '') ?? 'Someone who has left';
    const line = { ...m, text, label: chatLabel(chat), who };
    // The date and clock take about six tokens beside the label.
    const cost = estimateTokens(`- [${line.label}, Thu 5 Nov 14:02] ${who}: ${text}`) + 1;
    if (used + cost > CARRY_TOKENS) break;
    used += cost;
    out.push(line);
  }
  return out;
}

export const CARRY_HEADING =
  'Said in your other chats with them since your memory was last brought up to date, newest first. You were there, so you know it:';

/** How a bot uses what it saw elsewhere, in a one-on-one. */
export const CARRY_RULES_DIRECT =
  'Use these as things you know, naturally ("you mentioned in the group that..."). What was said in a group was said in front of everyone in it.';

/** In a group, where its one-on-one with the person is private. */
export const CARRY_RULES_GROUP =
  'Use these as things you know, naturally. What they told you one-on-one is between you and them: draw on it where it helps, but do not repeat a detail from it in the group unless it is relevant and harmless, and when in doubt ask them first. You do not know what they told the others one-on-one.';

/** The carried messages as a block of the bot's context; empty when there are none. */
export function carryOverText(
  lines: readonly CarriedLine[],
  where: 'direct' | 'group',
  { now, timeZone }: { now: Date; timeZone: string },
): string {
  if (lines.length === 0) return '';
  const body = lines.map(
    (l) =>
      `- [${l.label}, ${whenDate(l.createdAt, { timeZone, weekday: 'short', year: 'auto', now })} ${zoneClock(l.createdAt, timeZone)}] ${l.who}: ${l.text}`,
  );
  return [CARRY_HEADING, ...body, '', where === 'group' ? CARRY_RULES_GROUP : CARRY_RULES_DIRECT].join('\n');
}
