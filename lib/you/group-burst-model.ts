import { firstName, isReaction, REACTIONS, type Reaction } from '@/lib/you/group-chats-model';

/**
 * How a group chat answers the person (plan #2879.1.2), as pure rules the
 * run in lib/you/group-burst.ts applies and the tests drive.
 *
 * When the person writes, a burst starts. A director reads the thread and
 * picks who speaks next, or waits on the person; each picked bot writes one
 * text as itself, or passes silently when it has nothing new; then the
 * director looks again and may let a bot answer another bot, but only for a
 * direct question, a disagreement or a correction. The caps below are
 * enforced here on every plan, whatever the director or the bots say, so a
 * group cannot talk to itself for long.
 *
 * The caps scale with the group (plan #3080): up to half the group answers
 * the person (never fewer than three), and an exchange holds twice that many
 * bot messages (never fewer than six), so a group of two to six bots keeps
 * the three and six it always had and a group of eight gets four and eight.
 * When the person speaks to everyone or names several bots, every one of
 * them answers once, whatever the cap.
 */

/** The fewest bots that may answer the person's message itself, whatever the group's size. */
export const MIN_OPENERS = 3;
/** The fewest bot messages one exchange may hold, whatever the group's size. */
export const MIN_BOT_MESSAGES = 6;
/** At most this many bots answer bots in one reply round, whatever the group's size. */
export const MAX_REPLIERS = 3;
/** After a round where everyone the person spoke to answered, this many more bot messages may follow. */
export const ADDRESSED_REPLY_ROOM = 2;
/** At most this many rounds of bots answering bots, after the opening round. */
export const MAX_REPLY_ROUNDS = 2;
/** No bot speaks more than this often in one burst. */
export const MAX_PER_BOT = 2;
/** How many replans one run makes when the person keeps typing mid-burst; past it the next send starts afresh. */
export const MAX_REPLANS = 3;
/** The run stops starting turns this long before the request's time runs out, and hands on to a chained request. */
export const CHAIN_RESERVE_MS = 45_000;
/** How long one request may run, as the route's maxDuration says (seconds, as milliseconds). */
export const BURST_REQUEST_MS = 300_000;
/** The longest a bot's text in a group runs, in tokens. */
export const SPEAKER_MAX_TOKENS = 400;
/** The director's longest answer, in tokens. */
export const DIRECTOR_MAX_TOKENS = 500;
/** How many of the thread's newest messages the director and each speaker read. */
export const THREAD_READ = 30;

/** Why the director lets a bot answer a bot. Anything else waits on the person. */
export const REPLY_REASONS = ['question', 'disagreement', 'correction'] as const;
export type ReplyReason = (typeof REPLY_REASONS)[number];
export type PickReason = 'answer' | ReplyReason;

export type BurstMember = { id: string; key: string; name: string };

/** One line of the thread as the director reads it; speakerId null for the person. */
export type BurstLine = { id: string; speakerId: string | null; text: string };

export type DirectorPick = { key: string; why: PickReason };
export type DirectorReaction = { key: string; line: number; reaction: Reaction };
export type DirectorPlan = { wait: boolean; picks: DirectorPick[]; reactions: DirectorReaction[] };

/** Where a burst stands: which round, and who has spoken in it in order. */
export type BurstState = {
  /** 0 while bots answer the person's message, then 1 and 2 for bots answering bots. */
  round: number;
  /** Bot ids in the order they spoke since the person's message. */
  spoken: string[];
};

export const WAIT: DirectorPlan = { wait: true, picks: [], reactions: [] };

/**
 * Who the person's message is to (plan #3080). `named` are the bots it
 * names, in order. `addressed` are the bots that each answer once whatever
 * the cap: every member when it speaks to everyone, the named ones when it
 * names two or more, and nobody otherwise. `keepGoing` is a message asking
 * the group to carry on.
 */
export type BurstAsk = { named: string[]; addressed: string[]; everyone: boolean; keepGoing: boolean };

export const OPEN_ASK: BurstAsk = { named: [], addressed: [], everyone: false, keepGoing: false };

/** How many bots answer the person, and how many bot messages one exchange holds, in a group this size. */
export function groupCaps(size: number): { openers: number; messages: number } {
  const openers = Math.max(MIN_OPENERS, Math.ceil(size / 2));
  return { openers, messages: Math.max(MIN_BOT_MESSAGES, 2 * openers) };
}

/** The caps for one exchange: the group's, widened so everyone addressed answers and a couple may reply. */
export function capsFor(size: number, ask: BurstAsk = OPEN_ASK): { openers: number; messages: number } {
  const caps = groupCaps(size);
  const addressed = ask.addressed.length;
  return { openers: Math.max(caps.openers, addressed), messages: Math.max(caps.messages, addressed + (addressed > 0 ? ADDRESSED_REPLY_ROOM : 0)) };
}

const EVERYONE_WORDS = String.raw`every ?one|every ?body|all of you|each of you|you all|y'?all|you guys|go(?:ing)? (?:a)?round|round the (?:table|room|group)|around the (?:table|room|group)`;
/** "everyone" as a word for the group, not as part of a sentence about other people: "everyone at work". */
const EVERYONE_AS_ADDRESS = new RegExp(
  String.raw`(^|[^\p{L}])(?:all of you|each of you|y'?all|go(?:ing)? (?:a)?round|(?:a)?round the (?:table|room|group))(?![\p{L}])` +
    String.raw`|^[\s\p{P}]*(?:hey|hi|hello|ok|okay|so|right|alright|morning|evening)[\s,!]+(?:every ?one|every ?body|you all|you guys)(?![\p{L}])` +
    String.raw`|(?:every ?one|every ?body|you all|you guys)(?:'s)?(?=\s*(?:[,.!?:]|$|(?:please\s+)?(?:say|tell|give|share|answer|weigh|chime|pick|name|introduce|go|think|thinks|reply|respond|list|vote|rate|suggest|write|send|drop|add|offer|one)(?![\p{L}])))`,
  'iu',
);
const KEEP_GOING = /^[\s\p{P}]*(?:(?:ok(?:ay)?|yes|yeah|yep|sure|please|go on then|and)[\s,!.]+)?(?:keep going|keep it going|carry on|continue|go on|more please|keep talking)(?![\p{L}])[^?]{0,24}$/iu;

/** Who the person's message is to: whom it names, whether it speaks to everyone, whether it asks the group to keep going. */
export function askOf(text: string, members: readonly BurstMember[]): BurstAsk {
  const named = mentionedIn(text, members);
  const t = text.trim();
  const everyone = members.length > 1 && new RegExp(EVERYONE_WORDS, 'iu').test(t) && EVERYONE_AS_ADDRESS.test(t);
  const keepGoing = !everyone && named.length === 0 && KEEP_GOING.test(t);
  const addressed = everyone ? [...named, ...members.map((m) => m.id).filter((id) => !named.includes(id))] : named.length >= 2 ? [...named] : [];
  return { named, addressed, everyone, keepGoing };
}

/** Whether the exchange can hold no more bot turns, so the director need not be asked again. */
export function burstFull(state: BurstState, size: number, ask: BurstAsk = OPEN_ASK): boolean {
  return state.round > MAX_REPLY_ROUNDS || state.spoken.length >= capsFor(size, ask).messages;
}

/** The bot's whole text when it chooses to say nothing: never shown, never saved (plan #3080). */
export const PASS_WORD = 'PASS';

/** Whether a bot's text is a pass rather than something to post. */
export function isPass(text: string): boolean {
  return /^[\s("[*_]*pass[\s)"\].!*_]*$/i.test(text);
}

/**
 * The bots the person named in their message: "@Ada", "Ada," or a full
 * name, matched on whole words, in the order they appear.
 */
export function mentionedIn(text: string, members: readonly BurstMember[]): string[] {
  const lower = text.toLowerCase();
  const found: { id: string; at: number }[] = [];
  for (const m of members) {
    const names = [m.name.toLowerCase(), firstName(m.name).toLowerCase()].filter((n) => n.length >= 2);
    let at = -1;
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(^|[^\\p{L}\\p{N}])@?${escaped}(?![\\p{L}\\p{N}])`, 'u').exec(lower);
      if (match && (at < 0 || match.index < at)) at = match.index;
    }
    if (at >= 0) found.push({ id: m.id, at });
  }
  // A first name two members share names neither.
  const firsts = new Map<string, number>();
  for (const m of members) firsts.set(firstName(m.name).toLowerCase(), (firsts.get(firstName(m.name).toLowerCase()) ?? 0) + 1);
  return found
    .filter((f) => {
      const m = members.find((x) => x.id === f.id);
      if (!m) return false;
      const shared = (firsts.get(firstName(m.name).toLowerCase()) ?? 0) > 1;
      return !shared || lower.includes(m.name.toLowerCase());
    })
    .sort((a, b) => a.at - b.at)
    .map((f) => f.id);
}

/**
 * Whether a bot's text asks the person something: it holds a question and
 * names no other member, so the question is to them. The burst ends there,
 * and the person answers.
 */
export function asksPerson(text: string, speakerId: string, members: readonly BurstMember[]): boolean {
  if (!text.includes('?')) return false;
  const others = members.filter((m) => m.id !== speakerId);
  return mentionedIn(text, others).length === 0;
}

/**
 * The bots that speak next, in order, from what the director asked for,
 * with every cap applied. Returns nothing when the burst is over.
 *
 *   - Round 0 answers the person. When the message speaks to everyone or
 *     names several bots, every one of them speaks once, in the order the
 *     message named them and then the director's, and nobody else. Otherwise
 *     up to groupCaps().openers, any bot the person named first whatever the
 *     director said; a "keep going" with no pick takes `fallback`.
 *   - Rounds 1 to MAX_REPLY_ROUNDS answer bots, at most MAX_REPLIERS a round,
 *     and only for a question, a disagreement or a correction; a pick for any
 *     other reason is dropped.
 *   - No bot twice in a row (an addressed bot waits for the next slot instead
 *     of losing its turn), none more than MAX_PER_BOT times, and no more than
 *     capsFor().messages in all.
 *   - Only members speak.
 */
export function planTurns(
  plan: DirectorPlan,
  state: BurstState,
  members: readonly BurstMember[],
  asked: readonly string[] | BurstAsk = OPEN_ASK,
  fallback: readonly string[] = [],
): string[] {
  if (state.round > MAX_REPLY_ROUNDS) return [];
  const ask: BurstAsk = 'addressed' in asked ? asked : { ...OPEN_ASK, named: [...asked] };
  const idOf = new Map(members.map((m) => [m.key, m.id]));
  const memberIds = new Set(members.map((m) => m.id));
  const caps = capsFor(members.length, ask);
  const picked = plan.wait ? [] : plan.picks.map((p) => idOf.get(p.key)).filter((id): id is string => Boolean(id));
  let wanted: string[];
  let roundCap: number;
  const must = new Set<string>();
  if (state.round === 0) {
    const addressed = ask.addressed.filter((id) => memberIds.has(id));
    const named = ask.named.filter((id) => memberIds.has(id));
    if (addressed.length > 0) {
      wanted = [...named, ...picked, ...addressed].filter((id) => addressed.includes(id));
      for (const id of addressed) must.add(id);
      roundCap = addressed.length;
    } else {
      wanted = [...named, ...picked];
      if (wanted.length === 0 && ask.keepGoing) wanted = fallback.filter((id) => memberIds.has(id));
      roundCap = Math.max(caps.openers, named.length);
    }
  } else {
    if (plan.wait) return [];
    wanted = plan.picks
      .filter((p) => (REPLY_REASONS as readonly string[]).includes(p.why))
      .map((p) => idOf.get(p.key))
      .filter((id): id is string => Boolean(id));
    roundCap = MAX_REPLIERS;
  }

  const out: string[] = [];
  const count = new Map<string, number>();
  for (const id of state.spoken) count.set(id, (count.get(id) ?? 0) + 1);
  let last = state.spoken[state.spoken.length - 1] ?? null;
  const roomLeft = caps.messages - state.spoken.length;
  const queue = [...new Set(wanted)];
  const deferred = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (out.length >= roomLeft || out.length >= roundCap) break;
    if (out.includes(id)) continue;
    // An addressed bot has one turn: one it already took (before a chained request) is not taken again.
    if (must.has(id) && count.has(id)) continue;
    if (id === last) {
      if (must.has(id) && !deferred.has(id)) {
        deferred.add(id);
        queue.push(id);
      }
      continue;
    }
    if ((count.get(id) ?? 0) >= MAX_PER_BOT) continue;
    out.push(id);
    count.set(id, (count.get(id) ?? 0) + 1);
    last = id;
  }
  return out;
}

/**
 * The bots to carry on with when the person says "keep going" and the
 * director picks nobody: whoever has gone longest without speaking first,
 * those who never spoke in the lines read before them.
 */
export function quietestFirst(lines: readonly BurstLine[], members: readonly BurstMember[]): string[] {
  const lastAt = new Map<string, number>();
  lines.forEach((l, i) => {
    if (l.speakerId) lastAt.set(l.speakerId, i);
  });
  return members
    .map((m, order) => ({ id: m.id, at: lastAt.get(m.id) ?? -1, order }))
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((m) => m.id);
}

/** The director's reactions that can be saved: a member, a line that exists and is not their own, one per bot per line. */
export function planReactions(plan: DirectorPlan, lines: readonly BurstLine[], members: readonly BurstMember[]): { advisorId: string; messageId: string; reaction: Reaction }[] {
  const idOf = new Map(members.map((m) => [m.key, m.id]));
  const seen = new Set<string>();
  const out: { advisorId: string; messageId: string; reaction: Reaction }[] = [];
  for (const r of plan.reactions) {
    const advisorId = idOf.get(r.key);
    const line = lines[r.line - 1];
    if (!advisorId || !line || line.speakerId === advisorId) continue;
    const key = `${advisorId}:${line.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ advisorId, messageId: line.id, reaction: r.reaction });
    if (out.length >= members.length) break;
  }
  return out;
}

/** The director's tool answer as a plan; anything malformed reads as waiting. */
export function directorPlanOf(input: unknown): DirectorPlan {
  if (!input || typeof input !== 'object') return WAIT;
  const o = input as Record<string, unknown>;
  const picks: DirectorPick[] = (Array.isArray(o.speakers) ? o.speakers : []).flatMap((p) => {
    const r = (p ?? {}) as Record<string, unknown>;
    const key = typeof r.bot === 'string' ? r.bot.trim() : '';
    const why = r.why === 'question' || r.why === 'disagreement' || r.why === 'correction' ? r.why : 'answer';
    return key ? [{ key, why }] : [];
  });
  const reactions: DirectorReaction[] = (Array.isArray(o.reactions) ? o.reactions : []).flatMap((p) => {
    const r = (p ?? {}) as Record<string, unknown>;
    const key = typeof r.bot === 'string' ? r.bot.trim() : '';
    const line = typeof r.line === 'number' && Number.isInteger(r.line) ? r.line : NaN;
    return key && Number.isFinite(line) && isReaction(r.reaction) ? [{ key, line, reaction: r.reaction }] : [];
  });
  const wait = o.wait === true || picks.length === 0;
  return { wait, picks: wait ? [] : picks, reactions };
}

/** The director's tool, for a forced tool call. */
export const DIRECTOR_TOOL = {
  name: 'plan_turns',
  description: 'Say who in the group speaks next, which reactions to add, or that everyone waits for the person.',
  input_schema: {
    type: 'object' as const,
    properties: {
      wait: { type: 'boolean', description: 'True when nobody should write now and the group waits for the person.' },
      speakers: {
        type: 'array',
        description: 'Who writes next, in order. Empty when waiting.',
        items: {
          type: 'object',
          properties: {
            bot: { type: 'string', description: 'The bot key.' },
            why: { type: 'string', enum: ['answer', ...REPLY_REASONS], description: 'answer: answering the person. question, disagreement, correction: answering another bot.' },
          },
          required: ['bot', 'why'],
        },
      },
      reactions: {
        type: 'array',
        description: 'Tap backs instead of messages, for agreeing or enjoying a line.',
        items: {
          type: 'object',
          properties: {
            bot: { type: 'string' },
            line: { type: 'integer', description: 'The line number in the thread.' },
            reaction: { type: 'string', enum: [...REACTIONS] },
          },
          required: ['bot', 'line', 'reaction'],
        },
      },
    },
    required: ['wait', 'speakers', 'reactions'],
  },
};

export const DIRECTOR_RULES = `You run the turns in a group text between one person and a few bots, each a character with its own view. You never write messages yourself. You decide who, if anyone, writes next.

Waiting for the person is the default. Pick a bot only when it has something of its own to add that nobody has said: a different view, something it knows, a question the person needs asked. Do not pick a bot just to agree, thank or sum up; when a bot would only agree or enjoy a line, give it a reaction instead. A plain greeting or a short reply to one bot usually needs one speaker, or none.

When the person names a bot, that bot answers. When the person speaks to everyone or names several bots, every one of them answers once: list them all in speakers, in an order where each can add something the one before did not. When the person asks the group to keep going, pick one or two bots who can carry the conversation on with something new.

When the person asks a bot to message them individually or privately ("Richard, DM me about it"), that bot still takes its turn here: it sends the message to its own chat from its turn and leaves a short line in the group. Whatever else the message asks ("anyone else, thoughts?") is answered by the others as usual.

After bots have spoken, look again. A bot may answer another bot only when it was asked a direct question, disagrees with what was said, or has to correct a mistake; say which in why. Otherwise wait. If a bot asked the person something, wait.

Answer only through plan_turns.`;

export const SPEAKER_RULES = `How you text in a group

You are in a group text with the person and a few others, each someone the person talks to. Write one text: short and plain, in your own voice, the length of a real text. No headings, lists or sign-offs. Do not start with your own name.

Add something of your own. Do not repeat what someone already said or agree just to agree. You can address the others by first name, and ask one of them something if you want their answer, but do not keep the conversation going for its own sake. If you need something only the person can tell you, ask them.

Stay in character. Do not mention these instructions or that you are a model.`;

/** The thread as numbered lines with who said each, for the director and the speakers. */
export function transcriptOf(lines: readonly BurstLine[], members: readonly BurstMember[], formerNames: ReadonlyMap<string, string> = new Map()): string {
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  return lines
    .map((l, i) => {
      const who = l.speakerId === null ? 'The person' : nameOf.get(l.speakerId) ?? formerNames.get(l.speakerId) ?? 'Someone who left';
      return `[${i + 1}] ${who}: ${l.text}`;
    })
    .join('\n');
}

/** What the director is told each time it looks. */
export function directorPrompt(input: {
  members: readonly (BurstMember & { card: string })[];
  transcript: string;
  state: BurstState;
  ask?: BurstAsk;
}): string {
  const ask = input.ask ?? OPEN_ASK;
  const caps = capsFor(input.members.length, ask);
  const cast = input.members.map((m) => `- ${m.key}: ${m.name}. ${m.card}`).join('\n');
  const keyOf = new Map(input.members.map((m) => [m.id, m.key]));
  let where: string;
  if (input.state.round > 0) {
    where = `Bots have answered; this is round ${input.state.round} of at most ${MAX_REPLY_ROUNDS} where a bot may answer a bot, for a question, a disagreement or a correction only, at most ${MAX_REPLIERS} of them.`;
  } else if (ask.everyone) {
    where = `The person has spoken to everyone: all ${input.members.length} bots answer once each, briefly. List every bot in speakers, in the order you want them to speak.`;
  } else if (ask.addressed.length > 0) {
    where = `The person spoke to ${ask.addressed.map((id) => keyOf.get(id) ?? id).join(', ')}: each answers once, in that order.`;
  } else if (ask.keepGoing) {
    where = `The person asked the group to keep going. Up to ${caps.openers} bots may carry the conversation on; pick only those with something new.`;
  } else {
    where = `The person has just written. Up to ${caps.openers} bots may answer; pick only those with something new to add.`;
  }
  return `The bots in the group:\n${cast}\n\nThe thread, oldest first:\n${input.transcript}\n\n${where} ${caps.messages - input.state.spoken.length} bot messages are left before the group waits for the person.`;
}

/** Told to a bot that may say nothing (plan #3080): it passes rather than echo. */
export const PASS_RULES = `If you have nothing new to add, nothing the others have not already said, write only ${PASS_WORD} and nothing else. It is not shown to anyone, and passing is better than repeating someone.`;

/** Told to each bot when the person asked everyone, or several of them, to answer (plan #3080). */
export const BRIEF_RULES = 'The person asked several of you to answer, and each of you answers in turn. Keep yours to a sentence or two, and say something the others before you did not.';

/** A bot's text as it is kept: its own name taken off the front, wrapping quotes dropped; null when empty. */
export function cleanSpeech(text: string, name: string): string | null {
  let t = text.trim();
  const prefixes = [name, firstName(name)].filter(Boolean);
  for (const p of prefixes) {
    const re = new RegExp(`^\\[?\\d*\\]?\\s*${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i');
    t = t.replace(re, '');
  }
  t = t.replace(/^["“]+|["”]+$/g, '').trim();
  if (!t) return null;
  return t.length > 2_000 ? `${t.slice(0, 1_999).trimEnd()}…` : t;
}

/** The pause before a bot's text lands, as if typed: the same scale as a direct chat's bubbles. */
export function turnPauseMs(text: string): number {
  return Math.min(3_500, Math.max(800, 600 + text.length * 25));
}
