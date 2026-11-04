import { relativeLuminance } from '@/lib/theme/oklch';
import { MENTOR_PALETTE } from '@/lib/you/chat-threads-model';
import type { CouncilMemory } from '@/lib/you/council-model';

/**
 * Adding and editing the people you chat with (plan #2748.11), kept pure so
 * the tests need no database: the form as it is checked, the colours a
 * person may be drawn in, what Dash is asked when it drafts a card, and the
 * shapes the edit page reads.
 *
 * A person is a you.board_advisors row. The form fills `name`, `colour`,
 * `focus` (who they are, the line under their name) and `persona_brief` (the
 * rest of what was filled in); the persona card is `persona`, which every
 * reply reads fresh (lib/you/chat-context.ts). Saving a new card keeps the
 * one it replaces in you.advisor_persona_versions (you 0040).
 */

export const PERSON_NAME_MAX = 120;
/** Who they are: the line under their name, kept in `focus`. */
export const WHO_MAX = 300;
export const TONE_MAX = 300;
export const CARES_MAX = 600;
export const NEVER_MAX = 600;
/** The persona column's own limit (you 0038). */
export const PERSONA_MAX = 8000;
/** A redraft's sentence ("make Ben blunter and shorter"). */
export const ASK_MAX = 500;
/** A line of what they remember (you.advisor_memory.text). */
export const MEMORY_LINE_MAX = 1000;
/** How many earlier cards the edit page lists. */
export const VERSIONS_SHOWN = 10;

export const LENGTHS = ['short', 'medium', 'long'] as const;
export const BUBBLES = ['one', 'few', 'many'] as const;
export type ReplyLength = (typeof LENGTHS)[number];
export type ReplyBubbles = (typeof BUBBLES)[number];

export const LENGTH_LABELS: Record<ReplyLength, string> = { short: 'Short', medium: 'Medium', long: 'Long' };
export const BUBBLE_LABELS: Record<ReplyBubbles, string> = { one: 'One text', few: 'A few', many: 'Many' };

/** What the form holds besides the name and colour: you.board_advisors.persona_brief, and `who` in focus. */
export type PersonBrief = {
  who: string;
  length: ReplyLength;
  bubbles: ReplyBubbles;
  tone: string;
  cares: string;
  never: string;
};

export const EMPTY_BRIEF: PersonBrief = { who: '', length: 'short', bubbles: 'few', tone: '', cares: '', never: '' };

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const oneLine = (value: unknown): string => str(value).replace(/\s+/g, ' ');

/** The brief as stored, or the empty one; `focus` stands in for `who` on a mentor nobody has edited. */
export function briefOf(value: unknown, focus: string | null = null): PersonBrief {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    who: str(row.who) || focus || '',
    length: LENGTHS.find((l) => l === row.length) ?? EMPTY_BRIEF.length,
    bubbles: BUBBLES.find((b) => b === row.bubbles) ?? EMPTY_BRIEF.bubbles,
    tone: str(row.tone),
    cares: str(row.cares),
    never: str(row.never),
  };
}

// ---------------------------------------------------------------------------
// Colour.
// ---------------------------------------------------------------------------

/** White on the colour, as a contrast ratio. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/** The floor for initials drawn in white on the person's colour. */
export const WHITE_CONTRAST_MIN = 4.5;

/** A colour a person may be drawn in: one of the palette, or any #rrggbb that carries white initials at 4.5:1. */
export function colourAllowed(value: string): boolean {
  const hex = value.toLowerCase();
  if ((MENTOR_PALETTE as readonly string[]).includes(hex)) return true;
  return /^#[0-9a-f]{6}$/.test(hex) && contrastWithWhite(hex) >= WHITE_CONTRAST_MIN;
}

// ---------------------------------------------------------------------------
// The form.
// ---------------------------------------------------------------------------

export type PersonForm = {
  name: string;
  colour: string;
  brief: PersonBrief;
  persona: string;
  joinsMeetings: boolean;
};

export type CleanPerson = PersonForm & { persona: string };

/** The form as it is saved, or the first thing wrong with it, in words for the person. */
export function cleanPersonForm(input: {
  name?: unknown;
  colour?: unknown;
  brief?: Partial<Record<keyof PersonBrief, unknown>>;
  persona?: unknown;
  joinsMeetings?: unknown;
}): { ok: true; value: CleanPerson } | { ok: false; error: string } {
  const name = oneLine(input.name);
  const colour = str(input.colour).toLowerCase();
  const brief = briefOf(input.brief ?? {});
  brief.who = oneLine(input.brief?.who);
  brief.tone = oneLine(input.brief?.tone);
  const persona = str(input.persona);
  if (!name) return { ok: false, error: 'Give them a name first.' };
  if (name.length > PERSON_NAME_MAX) return { ok: false, error: `Keep the name to ${PERSON_NAME_MAX} characters.` };
  if (!colourAllowed(colour)) return { ok: false, error: 'Pick one of the colours.' };
  if (brief.who.length > WHO_MAX) return { ok: false, error: `Keep who they are to ${WHO_MAX} characters.` };
  if (brief.tone.length > TONE_MAX) return { ok: false, error: `Keep the tone to ${TONE_MAX} characters.` };
  if (brief.cares.length > CARES_MAX) return { ok: false, error: `Keep what they care about to ${CARES_MAX} characters.` };
  if (brief.never.length > NEVER_MAX) return { ok: false, error: `Keep what they never say to ${NEVER_MAX} characters.` };
  if (!persona) return { ok: false, error: 'Write their card, or have Dash draft it.' };
  if (persona.length > PERSONA_MAX) return { ok: false, error: `Keep the card to ${PERSONA_MAX} characters.` };
  return { ok: true, value: { name, colour, brief, persona, joinsMeetings: input.joinsMeetings === true } };
}

/** What a new person's draft needs before Dash can write one. */
export function draftReady(name: string, brief: PersonBrief): string | null {
  if (!name.trim()) return 'Give them a name first.';
  if (!brief.who.trim() && !brief.tone.trim() && !brief.cares.trim()) return 'Say who they are, how they sound or what they care about first.';
  return null;
}

// ---------------------------------------------------------------------------
// Drafting.
// ---------------------------------------------------------------------------

export const DRAFT_TOOL = 'write_persona_card';

export const DRAFT_RULES = [
  'You write persona cards for the people someone texts with in a messaging app. A card is read before every reply that person writes, as the whole of who they are.',
  'Write the card in the second person, addressed to the character: "You are…". Four short sections, each a paragraph with its heading on its own line: Who you are, How you talk, What you care about, What you never do.',
  'How you talk must say how long a reply runs and how many separate texts it is, in plain numbers ("one or two sentences a text, two or three texts"), and the tone in concrete terms a writer could follow.',
  'Use only what the form says, and what the current card says when there is one. Invent no biography, credentials or facts about the person they text.',
  'Keep it under 2,500 characters. No markdown beyond the headings, no lists of more than five items.',
].join('\n');

const LENGTH_WORDS: Record<ReplyLength, string> = {
  short: 'short: a sentence or two a text',
  medium: 'medium: two to four sentences a text',
  long: 'long: a full paragraph when it helps',
};
const BUBBLE_WORDS: Record<ReplyBubbles, string> = {
  one: 'one text a reply',
  few: 'two or three texts a reply',
  many: 'several quick texts a reply, as people text',
};

/** What Dash is told: the form, the current card for a redraft, and the sentence it was asked with. */
export function draftPrompt(input: { name: string; brief: PersonBrief; current?: string | null; ask?: string | null }): string {
  const { name, brief } = input;
  const lines = [
    `Name: ${name}`,
    brief.who ? `Who they are: ${brief.who}` : null,
    `Reply length: ${LENGTH_WORDS[brief.length]}`,
    `Texts per reply: ${BUBBLE_WORDS[brief.bubbles]}`,
    brief.tone ? `Tone: ${brief.tone}` : null,
    brief.cares ? `What they should care about: ${brief.cares}` : null,
    brief.never ? `Things they should never say: ${brief.never}` : null,
  ].filter(Boolean);
  const current = input.current?.trim();
  const ask = input.ask?.trim();
  if (current && ask) {
    return `${lines.join('\n')}\n\nTheir current card:\n<card>\n${current}\n</card>\n\nRewrite the card as asked, keeping what the ask does not touch: ${ask}\n\nCall ${DRAFT_TOOL}.`;
  }
  return `${lines.join('\n')}\n\nWrite ${name}'s card from this form.\n\nCall ${DRAFT_TOOL}.`;
}

/** The card Dash wrote, or null when it wrote nothing usable. */
export function draftedCard(input: unknown): string | null {
  const card = str((input as { card?: unknown } | null)?.card);
  if (!card) return null;
  return card.length > PERSONA_MAX ? card.slice(0, PERSONA_MAX).trimEnd() : card;
}

// ---------------------------------------------------------------------------
// The edit page.
// ---------------------------------------------------------------------------

/** An earlier card, newest first on the page. */
export type PersonaVersion = { id: string; persona: string; madeBy: 'you' | 'dash'; ask: string | null; createdAt: string };

export function versionOf(row: Record<string, unknown>): PersonaVersion | null {
  const persona = str(row.persona);
  if (typeof row.id !== 'string' || !persona) return null;
  return {
    id: row.id,
    persona,
    madeBy: row.made_by === 'dash' ? 'dash' : 'you',
    ask: str(row.ask) || null,
    createdAt: str(row.created_at),
  };
}

/** Everything the edit form opens with for one person. */
export type PersonCard = {
  id: string;
  key: string;
  name: string;
  colour: string;
  kind: 'seat' | 'guest';
  madeByYou: boolean;
  brief: PersonBrief;
  persona: string;
  joinsMeetings: boolean;
  versions: PersonaVersion[];
  memory: CouncilMemory[];
};

/** A new person's form before anything is typed: the first palette colour nobody uses yet. */
export function newPersonCard(taken: readonly string[]): PersonCard {
  const colour = MENTOR_PALETTE.find((c) => !taken.includes(c)) ?? MENTOR_PALETTE[0];
  return {
    id: '',
    key: '',
    name: '',
    colour,
    kind: 'guest',
    madeByYou: true,
    brief: EMPTY_BRIEF,
    persona: '',
    joinsMeetings: false,
    versions: [],
    memory: [],
  };
}

/** Chat's Bots tab (plan #2879.3): every bot A to Z, with the form beside the list. */
export const BOTS_HREF = '/chat/bots';

/** Where a bot's form is: its row on the Bots tab. */
export function editHref(key: string): string {
  return `${BOTS_HREF}/${key}`;
}
export const ADD_HREF = `${BOTS_HREF}?add=1`;

/**
 * Whether a mentor can text: a seat always, a guest once Dash has built their
 * brain, and a person of the person's own once they have a card.
 */
export function canTalkOf(advisor: { kind: 'seat' | 'guest'; brainStatus: string; madeByYou?: boolean; hasPersona?: boolean }): boolean {
  return advisor.kind === 'seat' || advisor.brainStatus === 'ready' || (advisor.madeByYou === true && advisor.hasPersona === true);
}
