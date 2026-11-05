/**
 * What a mentor reads before each reply (plan #2748.3), apart from the reads
 * in lib/you/chat-context.ts so it can be tested without a database.
 *
 * A thread with a mentor never ends, so a reply cannot read the whole of it.
 * It reads six layers instead, each with a budget in tokens, and the bundle
 * stays near 14,000 tokens whether the thread holds forty messages or forty
 * thousand:
 *
 *   persona   who the mentor is: the persona card (you.board_advisors.persona)
 *             and, in what room is left, their brain's rules and questions.
 *             It changes only when the mentor does, so it goes first and is
 *             sent as a cached prefix.
 *   memory    what they keep about the person (you.advisor_memory): open
 *             commitments first, then open threads, preferences and facts.
 *   episodes  the summaries of earlier conversations (you.advisor_episodes),
 *             newest first until the budget runs out.
 *   recall    up to five older messages found by their words, only when the
 *             new message refers back ("you said", "last time").
 *   recent    the newest forty or so messages word for word.
 *   live      today's date, time and place, what they wrote under Now, the
 *             todos due today and the goals the message bears on.
 *
 * Tokens are estimated from characters, at 3.5 to a token, which overcounts
 * English a little; the budgets are ceilings, so the estimate errs high.
 */
import type { Brain } from '@/lib/you/board-brain';
import type { CouncilMemory } from '@/lib/you/council-model';
import { whenDate, zoneClock, zoneDay } from '@/lib/core/when';

export const LAYER_NAMES = ['persona', 'memory', 'episodes', 'recall', 'recent', 'live'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

/** Each layer's ceiling in tokens. They sum to CHAT_CONTEXT_BUDGET. */
export const LAYER_BUDGETS: Record<LayerName, number> = {
  persona: 2_500,
  memory: 1_500,
  episodes: 2_500,
  recall: 1_000,
  recent: 5_500,
  live: 1_000,
};

export const CHAT_CONTEXT_BUDGET = LAYER_NAMES.reduce((sum, name) => sum + LAYER_BUDGETS[name], 0);

/** How many rows each read asks for; the budgets then decide how many are kept. */
export const READ_LIMITS = {
  recent: 40,
  episodes: 40,
  memory: 200,
  recallCandidates: 20,
  recall: 5,
  todos: 8,
  goals: 50,
  goalsKept: 2,
} as const;

/** One message longer than this is cut, so a pasted essay cannot crowd out the rest of the thread. */
export const MESSAGE_TOKENS_MAX = 1_200;
const SUMMARY_TOKENS_MAX = 600;
const RECALL_TOKENS_MAX = 180;
const NOW_TOKENS_MAX = 250;

const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The text cut to at most `max` tokens, at a word where one is near, ending with an ellipsis. */
export function cutToTokens(text: string, max: number): string {
  if (estimateTokens(text) <= max) return text;
  const room = Math.max(0, Math.floor(max * CHARS_PER_TOKEN) - 1);
  const head = text.slice(0, room);
  const space = head.lastIndexOf(' ');
  return `${(space > room * 0.8 ? head.slice(0, space) : head).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Inputs, as the loader reads them.
// ---------------------------------------------------------------------------

export type ContextMentor = {
  id: string;
  key: string;
  name: string;
  kind: 'seat' | 'guest';
  question: string;
  focus: string | null;
  persona: string | null;
  brain: Brain | null;
  madeByYou: boolean;
};

export type ContextMessage = {
  id: string;
  role: 'person' | 'advisor';
  kind: 'reply' | 'ack' | 'text_first';
  text: string;
  createdAt: string;
};

export type ContextEpisode = {
  id: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  summary: string;
};

export type ContextTodo = { title: string; dueOn: string | null; pinned: boolean };
export type ContextGoal = { id: string; title: string; detail: string | null; area: string | null; dueOn: string | null };

export type ContextLive = {
  now: Date;
  timeZone: string;
  /** Where they live now, "London, United Kingdom", from you.places. */
  place: string | null;
  /** What they wrote under Now (you.now), in their words. */
  nowNote: string | null;
  todos: ContextTodo[];
  /** The goals the message bears on, already ranked (rankGoals). */
  goals: ContextGoal[];
};

export type ChatContextInput = {
  mentor: ContextMentor;
  memory: CouncilMemory[];
  /** Summarised episodes, any order. */
  episodes: ContextEpisode[];
  /** Older messages found by their words, any order. */
  recall: ContextMessage[];
  /** The newest messages, oldest first. */
  recent: ContextMessage[];
  live: ContextLive;
};

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------

export type ContextLayer = {
  name: LayerName;
  text: string;
  tokens: number;
  budget: number;
  /** How many items the layer kept, and how many it had to leave out. */
  kept: number;
  dropped: number;
};

export type ChatContext = {
  mentor: { id: string; key: string; name: string };
  layers: Record<LayerName, ContextLayer>;
  /** The recent messages kept, oldest first, each cut to MESSAGE_TOKENS_MAX. */
  messages: ContextMessage[];
  tokens: number;
  budget: number;
};

/**
 * Lines in order of importance, kept while they fit. A heading is spent
 * first and kept only when at least one line is, unless `always`: the
 * persona and today's date stand on their own.
 */
function fill(name: LayerName, lines: string[], heading: string | null, always = false): ContextLayer {
  const budget = LAYER_BUDGETS[name];
  const kept: string[] = [];
  let used = heading ? estimateTokens(heading) + 1 : 0;
  let dropped = 0;
  for (const line of lines) {
    const cost = estimateTokens(line) + 1;
    if (used + cost <= budget) {
      kept.push(line);
      used += cost;
    } else {
      dropped += 1;
    }
  }
  const text = kept.length || always ? [heading, ...kept].filter((l): l is string => l !== null).join('\n') : '';
  return { name, text, tokens: estimateTokens(text), budget, kept: kept.length, dropped };
}

const day = (at: string, timeZone: string, now: Date) => whenDate(at, { timeZone, weekday: 'short', year: 'auto', now });

// ---------------------------------------------------------------------------
// The layers.
// ---------------------------------------------------------------------------

/** The persona card, or a card drawn from the row when none is written, then the brain in what room is left. */
export function personaLayer(mentor: ContextMentor): ContextLayer {
  const brain = mentor.brain;
  const card =
    mentor.persona ??
    [
      `Who you are: ${mentor.name}.${mentor.focus ? ` ${mentor.focus}` : ''}`,
      brain?.voice ? `How you talk: ${brain.voice}` : null,
      brain?.never.length ? `What you never do: ${brain.never.join(' ')}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');
  const who = mentor.kind === 'seat' && mentor.key !== 'mentor' ? `the ${mentor.name}` : mentor.name;
  const heading = `You are ${who}, one of the person's mentors, and you text with them in a thread that has run for as long as they have known you. The question you own: "${mentor.question}"\n\n${cutToTokens(card, 2_100)}`;
  const lines: string[] = [];
  if (brain) {
    if (brain.assessment) lines.push(`\nThe assessment you own, ${brain.assessment.name}: ${brain.assessment.text}`);
    if (brain.questions.length) lines.push(`\nQuestions you ask:\n${brain.questions.map((q) => `- ${q}`).join('\n')}`);
    for (const [i, rule] of brain.rules.entries()) lines.push(`${i === 0 ? '\nYour rules, with their sources:\n' : ''}- ${rule}`);
    for (const [i, f] of brain.frameworks.entries()) lines.push(`${i === 0 ? '\nHow you think:\n' : ''}- ${f.name}: ${f.text}`);
    for (const [i, p] of brain.positions.entries()) lines.push(`${i === 0 ? '\nWhere you stand:\n' : ''}- ${p.topic}: ${p.text}`);
  }
  return fill('persona', lines, heading, true);
}

const MEMORY_ORDER = (m: CouncilMemory): number => {
  if (m.kind === 'commitment') return m.doneAt ? 4 : 0;
  return { open_thread: 1, preference: 2, fact: 3 }[m.kind];
};

export function memoryLayer(memory: CouncilMemory[]): ContextLayer {
  const ordered = [...memory].sort(
    (a, b) =>
      MEMORY_ORDER(a) - MEMORY_ORDER(b) ||
      (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const lines = ordered.map((m) => {
    const label =
      m.kind === 'commitment'
        ? m.doneAt
          ? 'commitment, done'
          : m.dueOn
            ? `commitment, due ${m.dueOn}`
            : 'commitment'
        : m.kind.replace('_', ' ');
    return `- [${label}] ${cutToTokens(m.text, 300)}`;
  });
  return fill('memory', lines, 'What you remember about them:');
}

/** Episodes before the recent window, newest first; one the recent messages already cover is left out. */
export function episodesLayer(episodes: ContextEpisode[], recent: ContextMessage[], live: Pick<ContextLive, 'now' | 'timeZone'>): ContextLayer {
  const windowStart = recent[0]?.createdAt ?? null;
  const lines = [...episodes]
    .filter((e) => e.summary.trim() && (windowStart === null || e.startedAt < windowStart))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map(
      (e) =>
        `- ${day(e.startedAt, live.timeZone, live.now)} (${e.messageCount} message${e.messageCount === 1 ? '' : 's'}): ${cutToTokens(e.summary.trim(), SUMMARY_TOKENS_MAX)}`,
    );
  return fill('episodes', lines, 'Your earlier conversations with them, newest first:');
}

/** Words that say the new message is reaching back to something said before. */
const REFERS_BACK =
  /\b(remember|recall|you (said|told|mentioned|suggested|asked)|i (said|told you|mentioned)|we (talked|spoke|discussed)|last (time|week|month|year)|earlier|before|a while (ago|back)|back (when|then)|again|that (thing|idea|plan)|like you said|as you said)\b/i;

export function refersBack(message: string): boolean {
  return REFERS_BACK.test(message);
}

const STOP = new Set(
  (
    'about above after again also always another anything around back because been before being between both could did does doing done down during each else even ever every from further have having here into just know last like made make many maybe more most much must need never only other ought over really remember said same should since some something still such sure talked tell than that their them then there these they thing things think this those though thought through told very want week went were what when where which while will with would year your yours you\'re i\'m it\'s that\'s mentioned recall earlier month time'
  ).split(' '),
);

/**
 * The words of a message worth searching old messages for, joined with `or`
 * for websearch_to_tsquery, or null when none are left. At most six, in the
 * message's order: the words of a recall are usually its nouns.
 */
export function recallQuery(message: string): string | null {
  const words: string[] = [];
  for (const raw of message.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
    const word = raw.replace(/^'+|'+$/g, '');
    if (word.length < 4 || STOP.has(word) || words.includes(word)) continue;
    words.push(word);
    if (words.length === 6) break;
  }
  return words.length ? words.join(' or ') : null;
}

const termsOf = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 4 && !STOP.has(w)));

/** Older messages ranked by how many of the query's words they hold, then newest first; five kept. */
export function recallLayer(
  candidates: ContextMessage[],
  recent: ContextMessage[],
  query: string | null,
  live: Pick<ContextLive, 'now' | 'timeZone'>,
): ContextLayer {
  if (!query) return fill('recall', [], null);
  const terms = query.split(' or ');
  const windowStart = recent[0]?.createdAt ?? null;
  const inRecent = new Set(recent.map((m) => m.id));
  const ranked = candidates
    .filter((m) => !inRecent.has(m.id) && (windowStart === null || m.createdAt < windowStart))
    .map((m) => {
      const words = termsOf(m.text);
      return { m, score: terms.filter((t) => words.has(t)).length };
    })
    .sort((a, b) => b.score - a.score || b.m.createdAt.localeCompare(a.m.createdAt))
    .slice(0, READ_LIMITS.recall);
  const lines = ranked.map(
    ({ m }) =>
      `- ${day(m.createdAt, live.timeZone, live.now)}, ${m.role === 'person' ? 'they wrote' : 'you wrote'}: "${cutToTokens(m.text, RECALL_TOKENS_MAX)}"`,
  );
  return fill('recall', lines, 'Older messages that bear on what they just wrote:');
}

/**
 * The newest messages word for word, each cut to MESSAGE_TOKENS_MAX, dropping
 * the oldest until they fit. The newest is always kept.
 */
export function recentMessages(recent: ContextMessage[]): { layer: ContextLayer; messages: ContextMessage[] } {
  const cut = recent.map((m) => ({ ...m, text: cutToTokens(m.text, MESSAGE_TOKENS_MAX) }));
  const budget = LAYER_BUDGETS.recent;
  const kept: ContextMessage[] = [];
  let used = 0;
  for (let i = cut.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(transcriptLine(cut[i])) + 1;
    if (kept.length > 0 && used + cost > budget) break;
    kept.unshift(cut[i]);
    used += cost;
  }
  const text = kept.map(transcriptLine).join('\n');
  return {
    layer: { name: 'recent', text, tokens: estimateTokens(text), budget, kept: kept.length, dropped: cut.length - kept.length },
    messages: kept,
  };
}

function transcriptLine(m: ContextMessage): string {
  return `${m.role === 'person' ? 'Them' : 'You'}: ${m.text}`;
}

export function liveLayer(live: ContextLive): ContextLayer {
  const today = zoneDay(live.now, live.timeZone);
  const heading = `Now: ${whenDate(live.now, { timeZone: live.timeZone, weekday: 'long', month: 'long' })}, ${zoneClock(live.now, live.timeZone)} (${live.timeZone}).`;
  const lines: string[] = [];
  if (live.place) lines.push(`Where they live: ${live.place}.`);
  if (live.nowNote?.trim()) lines.push(`What they wrote under Now: "${cutToTokens(live.nowNote.trim(), NOW_TOKENS_MAX)}"`);
  for (const [i, t] of live.todos.entries()) {
    const when = t.dueOn ? (t.dueOn < today ? `overdue since ${t.dueOn}` : 'due today') : 'pinned';
    lines.push(`${i === 0 ? "Today's todos:\n" : ''}- ${cutToTokens(t.title, 60)} (${when})`);
  }
  for (const [i, g] of live.goals.entries()) {
    const bits = [g.area, g.dueOn ? `due ${g.dueOn}` : null].filter(Boolean).join(', ');
    lines.push(
      `${i === 0 ? 'Their goals this bears on:\n' : ''}- ${cutToTokens(g.title, 60)}${bits ? ` (${bits})` : ''}${g.detail ? `: ${cutToTokens(g.detail, 120)}` : ''}`,
    );
  }
  return fill('live', lines, heading, true);
}

// ---------------------------------------------------------------------------
// Goals the message bears on.
// ---------------------------------------------------------------------------

/** Areas a seat speaks for, matched against an area's name. Guests and the other seats have none. */
const SEAT_AREAS: Record<string, RegExp> = {
  hiring_manager: /career|job|work/i,
  mentor: /career|job|work/i,
  cfo: /money|financ|budget/i,
};

/**
 * The open goals that bear on this message and this mentor, best first, at
 * most READ_LIMITS.goalsKept. Nothing ties a mentor to a goal yet, so a goal
 * counts by the words it shares with the message and the mentor's question
 * and focus, with two more for being in the area a seat speaks for.
 */
export function rankGoals(goals: ContextGoal[], mentor: Pick<ContextMentor, 'key' | 'question' | 'focus'>, message: string): ContextGoal[] {
  const want = termsOf(`${message} ${mentor.question} ${mentor.focus ?? ''}`);
  const area = SEAT_AREAS[mentor.key];
  return goals
    .map((g) => {
      const words = termsOf(`${g.title} ${g.detail ?? ''} ${g.area ?? ''}`);
      let score = 0;
      for (const w of words) if (want.has(w)) score += 1;
      if (area && g.area && area.test(g.area)) score += 2;
      return { g, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.g.dueOn ?? '9999').localeCompare(b.g.dueOn ?? '9999'))
    .slice(0, READ_LIMITS.goalsKept)
    .map((x) => x.g);
}

// ---------------------------------------------------------------------------
// The bundle.
// ---------------------------------------------------------------------------

/** The newest message of the person's, which the reply answers and a recall searches from. */
export function newestFromPerson(recent: ContextMessage[]): ContextMessage | null {
  for (let i = recent.length - 1; i >= 0; i -= 1) if (recent[i].role === 'person') return recent[i];
  return null;
}

export function assembleChatContext(input: ChatContextInput, recallFor: string | null = null): ChatContext {
  const { layer: recent, messages } = recentMessages(input.recent);
  const query = recallFor && refersBack(recallFor) ? recallQuery(recallFor) : null;
  const layers: Record<LayerName, ContextLayer> = {
    persona: personaLayer(input.mentor),
    memory: memoryLayer(input.memory),
    episodes: episodesLayer(input.episodes, messages, input.live),
    recall: recallLayer(input.recall, messages, query, input.live),
    recent,
    live: liveLayer(input.live),
  };
  return {
    mentor: { id: input.mentor.id, key: input.mentor.key, name: input.mentor.name },
    layers,
    messages,
    tokens: LAYER_NAMES.reduce((sum, name) => sum + layers[name].tokens, 0),
    budget: CHAT_CONTEXT_BUDGET,
  };
}

// ---------------------------------------------------------------------------
// As a Messages API request.
// ---------------------------------------------------------------------------

export type PromptSystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };
export type PromptMessage = { role: 'user' | 'assistant'; content: string };

/** A gap this long between two messages is written into the thread, so the mentor knows time passed. */
const GAP_MARK_MS = 3 * 60 * 60 * 1000;

/**
 * The bundle as `system` and `messages` for the Messages API. The persona is
 * the first system block, marked for caching; memory, earlier conversations,
 * recall and the live rows are the second. The recent messages become turns,
 * the person's as user and the mentor's as assistant, with consecutive ones
 * of one side joined, a time mark where three quiet hours passed, and a
 * placeholder user turn first when the thread opens with the mentor (the API
 * starts with a user turn). The last turn is the person's when the newest
 * message is; the caller adds anything after it.
 */
export function chatPrompt(ctx: ChatContext, live: Pick<ContextLive, 'now' | 'timeZone'>): { system: PromptSystemBlock[]; messages: PromptMessage[] } {
  const rest = (['memory', 'episodes', 'recall', 'live'] as const)
    .map((name) => ctx.layers[name].text)
    .filter(Boolean)
    .join('\n\n');
  const system: PromptSystemBlock[] = [{ type: 'text', text: ctx.layers.persona.text, cache_control: { type: 'ephemeral' } }];
  if (rest) system.push({ type: 'text', text: rest });

  const messages: PromptMessage[] = [];
  let previous: number | null = null;
  for (const m of ctx.messages) {
    const at = Date.parse(m.createdAt);
    const mark =
      previous !== null && Number.isFinite(at) && at - previous >= GAP_MARK_MS
        ? `[${whenDate(m.createdAt, { timeZone: live.timeZone, weekday: 'short', year: 'auto', now: live.now })}, ${zoneClock(m.createdAt, live.timeZone)}] `
        : '';
    if (Number.isFinite(at)) previous = at;
    const role = m.role === 'person' ? 'user' : 'assistant';
    const content = `${mark}${m.text}`;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else messages.push({ role, content });
  }
  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: '(The thread opens with your message.)' });
  return { system, messages };
}
