import { firstName, isReaction, REACTIONS, type Reaction } from '@/lib/you/group-chats-model';

/**
 * How a group chat answers the person (plan #2879.1.2), as pure rules the
 * run in lib/you/group-burst.ts applies and the tests drive.
 *
 * When the person writes, a burst starts. A director reads the thread and
 * picks who speaks next, zero to three bots, or waits on the person; each
 * picked bot writes one text as itself; then the director looks again and
 * may let a bot answer another bot, but only for a direct question, a
 * disagreement or a correction. The caps below are enforced here on every
 * plan, whatever the director or the bots say, so a group cannot talk to
 * itself for long.
 */

/** At most this many bot messages answer one message from the person. */
export const MAX_BOT_MESSAGES = 6;
/** At most this many bots answer the person's message itself. */
export const MAX_OPENERS = 3;
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
 *   - Round 0 answers the person: up to MAX_OPENERS, any bot they named
 *     first whatever the director said.
 *   - Rounds 1 to MAX_REPLY_ROUNDS answer bots, and only for a question, a
 *     disagreement or a correction; a pick for any other reason is dropped.
 *   - No bot twice in a row, none more than MAX_PER_BOT times, and no more
 *     than MAX_BOT_MESSAGES in all.
 *   - Only members speak.
 */
export function planTurns(
  plan: DirectorPlan,
  state: BurstState,
  members: readonly BurstMember[],
  mentioned: readonly string[] = [],
): string[] {
  if (state.round > MAX_REPLY_ROUNDS) return [];
  const idOf = new Map(members.map((m) => [m.key, m.id]));
  const memberIds = new Set(members.map((m) => m.id));
  let wanted: string[];
  if (state.round === 0) {
    const named = mentioned.filter((id) => memberIds.has(id));
    const picked = plan.wait ? [] : plan.picks.map((p) => idOf.get(p.key)).filter((id): id is string => Boolean(id));
    wanted = [...named, ...picked];
  } else {
    if (plan.wait) return [];
    wanted = plan.picks
      .filter((p) => (REPLY_REASONS as readonly string[]).includes(p.why))
      .map((p) => idOf.get(p.key))
      .filter((id): id is string => Boolean(id));
  }

  const out: string[] = [];
  const count = new Map<string, number>();
  for (const id of state.spoken) count.set(id, (count.get(id) ?? 0) + 1);
  let last = state.spoken[state.spoken.length - 1] ?? null;
  const roomLeft = MAX_BOT_MESSAGES - state.spoken.length;
  // A round of bots answering bots is held to the same three as the opening.
  for (const id of wanted) {
    if (out.length >= roomLeft || out.length >= MAX_OPENERS) break;
    if (out.includes(id) || id === last) continue;
    if ((count.get(id) ?? 0) >= MAX_PER_BOT) continue;
    out.push(id);
    count.set(id, (count.get(id) ?? 0) + 1);
    last = id;
  }
  return out;
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

When the person names a bot, that bot answers. When the person asks everyone, pick the two or three with the most different things to say.

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
}): string {
  const cast = input.members.map((m) => `- ${m.key}: ${m.name}. ${m.card}`).join('\n');
  const where =
    input.state.round === 0
      ? `The person has just written. Up to ${MAX_OPENERS} bots may answer.`
      : `Bots have answered; this is round ${input.state.round} of at most ${MAX_REPLY_ROUNDS} where a bot may answer a bot, for a question, a disagreement or a correction only.`;
  return `The bots in the group:\n${cast}\n\nThe thread, oldest first:\n${input.transcript}\n\n${where} ${MAX_BOT_MESSAGES - input.state.spoken.length} bot messages are left before the group waits for the person.`;
}

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
