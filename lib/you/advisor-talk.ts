import type Anthropic from '@anthropic-ai/sdk';
import type { RosterAdvisor } from '@/lib/you/board-advisors';
import type { Brain } from '@/lib/you/board-brain';
import { percent, type AdvisorDecision } from '@/lib/you/board-profile';
import { OUTCOME_LABELS } from '@/lib/you/board-reviews';
import type { TalkCitation, TalkTurn } from '@/lib/talk/talk';

/**
 * Talking to one advisor alone (plan #2581.6): the Talk tab on an advisor's
 * profile, on Ask Dash's loop (lib/dash/loop.ts) with Ask's lookups, so the
 * advisor can read the person's rows and cite real numbers.
 *
 * What the advisor is told is built here from the stored rows: their brain
 * (lib/you/board-brain.ts), what they remember of the person
 * (you.advisor_memory, read first), the decisions they weighed in on, the
 * person's open decisions and their current goals. After each exchange one
 * cheap call writes what is worth remembering, which the next talk and the
 * next meeting (.claude/skills/board/SKILL.md, step 3) read.
 *
 * This file is the pure part; lib/you/advisor-talk-store.ts reads and writes
 * the rows, and lib/you/advisor-talk-run.ts makes the calls.
 */

export const MEMORY_KINDS = ['fact', 'preference', 'commitment', 'open_thread'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** How each kind of memory is named on the profile. */
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  fact: 'Fact',
  preference: 'Preference',
  commitment: 'Commitment',
  open_thread: 'Open thread',
};

export type AdvisorMemory = { id: string; kind: MemoryKind; text: string; createdAt: string };

export type AdvisorChat = {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string | null;
};

/** What an advisor's message rests on: the rows a lookup returned, kept as you.advisor_messages.receipts. */
export type Receipt = { label: string; link: string; table?: string; ref?: string };

export type AdvisorMessage = {
  id: string;
  role: 'person' | 'advisor';
  text: string;
  receipts: Receipt[];
  createdAt: string;
};

/** A goal of theirs as the advisor is told it. */
export type TalkGoal = { title: string; dueOn: string | null };

/** An open decision of theirs, for the openers and the prompt. */
export type OpenDecision = { id: string; question: string };

/** Everything the advisor is told before the talk. */
export type TalkContext = {
  advisor: RosterAdvisor;
  brain: Brain | null;
  memory: readonly AdvisorMemory[];
  decisions: readonly AdvisorDecision[];
  open: readonly OpenDecision[];
  goals: readonly TalkGoal[];
};

/** The most memory rows told to the advisor, newest kept when there are more. */
export const MEMORY_TOLD = 60;
/** The most decisions they weighed in on that are told, newest first. */
export const DECISIONS_TOLD = 8;
/** The most open decisions and goals told. */
export const OPEN_TOLD = 8;
export const GOALS_TOLD = 15;
/** The most new memories one exchange writes. */
export const MEMORIES_PER_EXCHANGE = 4;
/** A memory's longest text, as you.advisor_memory allows. */
export const MEMORY_MAX = 1000;
/** A chat's longest title, as you.advisor_chats allows. */
export const TITLE_MAX = 200;
const TITLE_SHOWN = 80;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Receipts as stored, keeping only the ones with a label and a link. */
export function receiptsOf(value: unknown): Receipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Receipt[] => {
    if (!item || typeof item !== 'object') return [];
    const o = item as Record<string, unknown>;
    const label = str(o.label);
    const link = str(o.link);
    if (!label || !link) return [];
    const table = str(o.table);
    const ref = str(o.ref);
    return [{ label, link, ...(table ? { table } : {}), ...(ref ? { ref } : {}) }];
  });
}

/** The rows an answer cited, as receipts to keep. */
export function receiptsFrom(citations: readonly TalkCitation[]): Receipt[] {
  return citations.map((c) => ({ label: c.title, link: c.href, table: c.table, ref: c.ref }));
}

/** A message as the thread draws it. */
export function messageTurn(message: AdvisorMessage): TalkTurn {
  const citations = message.receipts.map(
    (r): TalkCitation => ({ table: r.table ?? '', ref: r.ref ?? r.link, title: r.label, href: r.link }),
  );
  return {
    id: message.id,
    role: message.role === 'person' ? 'user' : 'assistant',
    body: message.text,
    createdAt: message.createdAt,
    ...(citations.length > 0 ? { citations } : {}),
  };
}

/** A new chat's title: the person's first message, cut at a word. */
export function chatTitle(first: string): string {
  const line = first.replace(/\s+/g, ' ').trim();
  if (line.length <= TITLE_SHOWN) return line;
  const cut = line.slice(0, TITLE_SHOWN - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_SHOWN / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The person's last message when no reply followed it: a reply that failed,
 * which Try again asks for again. Null when the talk ends with the advisor.
 */
export function unanswered(messages: readonly Pick<AdvisorMessage, 'id' | 'role' | 'text'>[]): { id: string; text: string } | null {
  const last = messages[messages.length - 1];
  return last && last.role === 'person' ? { id: last.id, text: last.text } : null;
}

/**
 * A way into a first talk: what the press shows, short and leading with
 * what differs, and the message it sends.
 */
export type Opener = { shown: string; send: string };

/**
 * Three ways to open a first talk, drawn from the person's open decisions,
 * newest first: each shows the decision and sends it with the question of
 * what the advisor would want to know. With fewer than three open, the rest
 * come from their goals, then from the questions the advisor's brain says
 * they ask.
 */
export function openersFor(input: {
  advisor: Pick<RosterAdvisor, 'name' | 'question'>;
  brain: Brain | null;
  open: readonly OpenDecision[];
  goals: readonly TalkGoal[];
}): Opener[] {
  const out: Opener[] = [];
  const add = (shown: string, send: string) => {
    if (out.length < 3 && !out.some((o) => o.send === send)) out.push({ shown, send });
  };
  for (const decision of input.open) {
    const question = `${unquestion(decision.question)}?`;
    add(question, `What would you want to know before I decide: ${question}`);
  }
  for (const goal of input.goals) add(`My goal: ${goal.title}`, `How would you go about my goal "${goal.title}"?`);
  for (const question of input.brain?.questions ?? []) add(question, `Ask me this and hear my answer: ${question}`);
  if (out.length < 3) add('Where I am right now', 'What do you make of where I am right now?');
  if (out.length < 3) add(input.advisor.question, input.advisor.question);
  return out;
}

/** A question's own text without its closing mark, to set inside another. */
function unquestion(text: string): string {
  return text.trim().replace(/[?.!]+$/, '');
}

function list(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n');
}

function forecastLine(decision: AdvisorDecision): string {
  const name = (letter: string) => decision.options.find((o) => o.letter === letter)?.text ?? `option ${letter}`;
  const said = decision.forecast
    ? Object.keys(decision.forecast)
        .sort()
        .map((letter) => `${name(letter)} ${percent(decision.forecast![letter])}`)
        .join(', ')
    : decision.pick
      ? `you backed ${name(decision.pick)}`
      : 'you gave no single pick';
  const state = decision.chosen
    ? `they chose ${name(decision.chosen)}${decision.outcome ? `, and said: ${OUTCOME_LABELS[decision.outcome].toLowerCase()}` : ''}`
    : 'not decided yet';
  return `"${decision.question}" (asked ${decision.askedAt.slice(0, 10)}): ${said}; ${state}.`;
}

/** The advisor's own part of the prompt, from their brain; a short paragraph without one. */
function who(advisor: RosterAdvisor, brain: Brain | null): string {
  const guest = advisor.kind === 'guest';
  const opening = guest
    ? `You are ${advisor.name}, talking one on one with the person who keeps you on their board of advisors. You are an impression of ${advisor.name} drawn from their public work, which your sources list; you speak as them, from that work alone.`
    : `You are the ${advisor.name} on the person's board of advisors, talking with them one on one. You speak from the research and practice behind your role.`;
  const parts = [opening];
  if (brain?.assessment) {
    parts.push(`THE ASSESSMENT YOU OWN\n${brain.assessment.name}: ${brain.assessment.text}`);
  } else {
    parts.push(`THE QUESTION YOU OWN\n${advisor.question}${advisor.focus ? `\nWhat you look at: ${advisor.focus}` : ''}`);
  }
  if (!brain) return parts.join('\n\n');
  if (brain.voice) parts.push(`HOW YOU TALK\n${brain.voice}`);
  if (brain.questions.length) parts.push(`THE QUESTIONS YOU ASK\n${list(brain.questions)}`);
  if (brain.evidence.length) parts.push(`WHAT YOU ASK TO SEE FIRST\n${list(brain.evidence)}`);
  if (brain.rules.length) parts.push(`YOUR RULES\n${list(brain.rules)}`);
  if (brain.frameworks.length) parts.push(`HOW YOU WORK A PROBLEM\n${list(brain.frameworks.map((f) => `${f.name}: ${f.text}`))}`);
  if (brain.positions.length) parts.push(`WHERE YOU STAND\n${list(brain.positions.map((p) => `${p.topic}: ${p.text}`))}`);
  if (brain.contrarian.length) {
    parts.push(`WHERE YOU PART FROM THE USUAL VIEW\n${list(brain.contrarian.map((c) => `Most say ${c.common}. You: ${c.text}`))}`);
  }
  if (brain.disagreements.length) {
    parts.push(`WHO ON THE BOARD YOU DISAGREE WITH\n${list(brain.disagreements.map((d) => `${d.advisor}: ${d.text}`))}`);
  }
  if (brain.stories.length) {
    parts.push(
      `STORIES YOU MAY TELL, AND NO OTHERS\n${list(brain.stories.map((s) => `${s.date ? `${s.date}: ` : ''}${s.text}`))}`,
    );
  }
  if (brain.never.length) parts.push(`WHAT YOU WOULD NEVER SAY\n${list(brain.never)}`);
  return parts.join('\n\n');
}

function rules(advisor: RosterAdvisor): string {
  const guest = advisor.kind === 'guest';
  return `HOW TO TALK
Stay in character. Speak as ${advisor.name}, in the first person and in the voice above, for the whole talk. You are never an assistant, never Dash, and you never say you are an AI or name the company that made the model. If they ask who you really are, say you are ${guest ? `an impression of ${advisor.name} built from their public work` : `the ${advisor.name} on their board`}, and carry on in character.
${
  guest
    ? `Say so when something is outside what your public work supports: "I never wrote about that" or "that came after my time", then give only what your rules would imply, marked as your inference. Never invent a quote, a date or a story; the stories above are the only ones you tell.`
    : `Say so when something is outside your role, and name who on the board would answer it better.`
}
Keep to your assessment. Judge what they bring by it, and leave the other advisors' questions to them; you may say who on the board would see it differently.

USE THEIR REAL NUMBERS
Their dashboard holds what they earn, spend and owe, their job search, goals, notes, learning and plans, and your lookups read all of it. Before you give a figure about their life, look it up; never guess one. Give figures exactly as the lookups gave them, with their currency, and list every row you used in cited by the table and ref the lookup returned. Most turns need one or two lookups; a remark needs none.

HOW TO WRITE
This is a conversation, not a report. A few short paragraphs at most, and a sentence or two in reply to a remark. Plain prose to them as "you". No headings, no slogans, no contrast of the form "not X, but Y", and no dashes for rhythm. End with the one question you would put to them next only when you have one.

Answer through the answer tool.`;
}

/**
 * The system prompt for a talk: who the advisor is, how to talk, then what
 * they remember (read first), the decisions they weighed in on, the person's
 * open decisions and their goals.
 */
export function advisorSystem(context: TalkContext): string {
  const memory = context.memory.slice(-MEMORY_TOLD);
  const remembered =
    memory.length > 0
      ? list(memory.map((m) => `[${MEMORY_KIND_LABELS[m.kind].toLowerCase()}, ${m.createdAt.slice(0, 10)}] ${m.text}`))
      : 'Nothing yet: this is the first time you talk with them.';
  const weighed = context.decisions.slice(0, DECISIONS_TOLD);
  const open = context.open.slice(0, OPEN_TOLD);
  const goals = context.goals.slice(0, GOALS_TOLD);
  return [
    who(context.advisor, context.brain),
    rules(context.advisor),
    `WHAT YOU REMEMBER ABOUT THEM\nRead this first: it is what they told you in earlier talks and meetings, oldest first. Hold them to their commitments and pick up open threads when they bear on what is asked.\n${remembered}`,
    `DECISIONS YOU WEIGHED IN ON\n${weighed.length > 0 ? list(weighed.map(forecastLine)) : 'None yet.'}`,
    `THEIR OPEN DECISIONS\n${open.length > 0 ? list(open.map((d) => d.question)) : 'None open.'}`,
    `THEIR CURRENT GOALS\n${goals.length > 0 ? list(goals.map((g) => (g.dueOn ? `${g.title} (due ${g.dueOn})` : g.title))) : 'None recorded.'}`,
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// What to remember after an exchange
// ---------------------------------------------------------------------------

export const MEMORY_TOOL_NAME = 'remember';

export const MEMORY_TOOL: Anthropic.Tool = {
  name: MEMORY_TOOL_NAME,
  description: 'Record what is worth remembering from this exchange, and which earlier memories it shows are no longer true.',
  input_schema: {
    type: 'object',
    properties: {
      remember: {
        type: 'array',
        description: `At most ${MEMORIES_PER_EXCHANGE}. Empty when nothing is worth keeping.`,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...MEMORY_KINDS] },
            text: { type: 'string', description: 'One sentence to them as "you", with any date or figure they gave.' },
          },
          required: ['kind', 'text'],
          additionalProperties: false,
        },
      },
      retire: {
        type: 'array',
        description: 'The numbers of earlier memories this exchange shows are no longer true. Empty when none.',
        items: { type: 'integer' },
      },
    },
    required: ['remember', 'retire'],
    additionalProperties: false,
  },
};

/** The rules for the memory pass, for one advisor. */
export function memorySystem(advisorName: string): string {
  return `You keep the memory of ${advisorName}, one of a person's advisors, between their talks and meetings. Read the exchange and what ${advisorName} already remembers, then record what the next talk or meeting would need to know about the person:

- fact: something true of their life, work, money or situation ("You owe $18,400 on your student loans").
- preference: how they like to work, decide or be spoken to.
- commitment: something they said they will do, with its date if they gave one.
- open_thread: a question left unsettled that ${advisorName} should come back to.

Only what the person said, showed or agreed to. Never ${advisorName}'s own advice, and never a figure the exchange did not give. Skip what is already remembered, small talk, and anything the next talk would not need. Each is one sentence to them as "you". Most exchanges leave nothing or one thing; record at most ${MEMORIES_PER_EXCHANGE}.

If the exchange shows an earlier memory is no longer true, list its number in retire.

Answer through ${MEMORY_TOOL_NAME}.`;
}

/** The exchange and the memories so far, numbered, as the memory pass reads them. */
export function memoryPrompt(input: {
  memory: readonly Pick<AdvisorMemory, 'kind' | 'text'>[];
  person: string;
  advisor: string;
  advisorName: string;
}): string {
  const known =
    input.memory.length > 0
      ? input.memory.map((m, i) => `${i + 1}. [${m.kind}] ${m.text}`).join('\n')
      : 'Nothing yet.';
  return `WHAT ${input.advisorName.toUpperCase()} ALREADY REMEMBERS\n${known}\n\nTHE PERSON SAID\n${input.person.trim()}\n\n${input.advisorName.toUpperCase()} ANSWERED\n${input.advisor.trim()}`;
}

/**
 * What the memory pass returned, kept to its rules: known kinds, at most
 * MEMORIES_PER_EXCHANGE, none repeating one already held, and retirements
 * only of memories that were listed.
 */
export function memoriesFrom(
  input: unknown,
  known: readonly Pick<AdvisorMemory, 'id' | 'text'>[],
): { remember: { kind: MemoryKind; text: string }[]; retire: string[] } {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const held = new Set(known.map((m) => squash(m.text)));
  const remember: { kind: MemoryKind; text: string }[] = [];
  for (const item of Array.isArray(o.remember) ? o.remember : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const kind = MEMORY_KINDS.find((k) => k === r.kind);
    const text = str(r.text).replace(/\s+/g, ' ').slice(0, MEMORY_MAX);
    if (!kind || !text || held.has(squash(text))) continue;
    held.add(squash(text));
    remember.push({ kind, text });
    if (remember.length >= MEMORIES_PER_EXCHANGE) break;
  }
  const retire = [
    ...new Set(
      (Array.isArray(o.retire) ? o.retire : []).flatMap((n) =>
        typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= known.length ? [known[n - 1].id] : [],
      ),
    ),
  ];
  return { remember, retire };
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
