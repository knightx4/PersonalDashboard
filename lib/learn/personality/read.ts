import { whyNotRead } from '@/lib/vault/map/rules';
import { BIG_FIVE_FACTORS, FACTOR_WORDS, factorPercent } from './ipip';
import type { PersonalityResult, ReadPoint } from './model';
import type { TraitThemes } from './trait-themes';
import { traitSentences } from './trait-themes';

/**
 * Dash's read of a personality result against your notes (plan #1635): the
 * pure half. Which texts are embedded to find the notes, which notes are kept
 * and how much of each is sent, the prompt, and the check on what comes back.
 * read-run.ts does the reading, the call and the writing.
 *
 * The material is bounded so a read stays near the three to five cents the
 * feature settled on: at most READ_NOTES notes, each cut to NOTE_CHARS (a
 * pinned note such as "About me" to PINNED_CHARS), which with the prompt is
 * about six thousand tokens in and one thousand out on Sonnet.
 */

/** Notes sent with one read, pinned ones included. */
export const READ_NOTES = 15;
/** The nearest notes asked for on each text embedded. */
export const NOTES_PER_QUERY = 5;
/**
 * The similarity a note must reach to be considered. Lower than the 0.55 a
 * related note needs on a page: a trait sentence is general, and the model
 * says which notes bear on it, so a loose match costs a few hundred tokens
 * rather than a wrong link on a screen.
 */
export const READ_MIN_SIMILARITY = 0.4;
/** Characters of a note's body sent. */
export const NOTE_CHARS = 1_200;
/** Characters of a pinned note's body sent. */
export const PINNED_CHARS = 4_000;
/** Points kept from one read. */
export const MAX_POINTS = 8;
/** Characters kept of one point. */
export const POINT_CHARS = 400;

/** Titles of notes read whatever the embedding finds: what you wrote about yourself. */
export const PINNED_TITLES = ['About me'] as const;

/**
 * One text embedded for every read, beside the result's own, so the notes
 * where you describe yourself come up whatever the test says.
 */
export const SELF_QUERY =
  'How I see myself: my personality and temperament, what I am like with other people, what drains and what energises me.';

/** The texts embedded to find the notes a result is read against. */
export function readQueries(result: PersonalityResult): string[] {
  if (result.kind === 'big_five') {
    const sentences = traitSentences(result.scores);
    return [...BIG_FIVE_FACTORS.map((f) => sentences[f]), SELF_QUERY];
  }
  const own = [`${result.testName}: ${result.typedValue}.`, result.note ?? ''].join(' ').trim();
  return [own, SELF_QUERY];
}

/**
 * Whether a note may be sent. The map's rule (lib/vault/map/rules.ts) with
 * one difference: notes under Me/, which the map leaves out as journals, are
 * read here, because what you wrote about yourself is the point of the
 * comparison and the feature names "About me" as its source. Excluded
 * folders and notes holding a key are still never sent.
 */
export function mayRead(note: { path: string; body: string }): boolean {
  const why = whyNotRead(note);
  return why === null || why.reason === 'journal';
}

export type CandidateNote = { id: string; path: string; title: string; body: string };

/**
 * Choose the notes to send: the pinned ones first, then the nearest to each
 * text in turn, first of each list before the second of any, until there are
 * READ_NOTES. A note with nothing in it, or one that may not be sent, is
 * passed over.
 */
export function chooseNotes(
  pinned: readonly CandidateNote[],
  nearest: readonly (readonly CandidateNote[])[],
  limit = READ_NOTES,
): { note: CandidateNote; pinned: boolean }[] {
  const out: { note: CandidateNote; pinned: boolean }[] = [];
  const seen = new Set<string>();
  const take = (note: CandidateNote, isPinned: boolean) => {
    if (out.length >= limit || seen.has(note.id)) return;
    if (!note.body.trim() || !mayRead(note)) return;
    seen.add(note.id);
    out.push({ note, pinned: isPinned });
  };
  for (const note of pinned) take(note, true);
  const depth = Math.max(0, ...nearest.map((list) => list.length));
  for (let rank = 0; rank < depth; rank++) {
    for (const list of nearest) {
      const note = list[rank];
      if (note) take(note, false);
    }
  }
  return out;
}

function clip(text: string, chars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > chars ? `${flat.slice(0, chars - 1).trimEnd()}…` : flat;
}

/** The label a note goes by in the prompt: N1, N2, … */
export function noteLabel(index: number): string {
  return `N${index + 1}`;
}

export const READ_TOOL = 'report_read';

export const READ_SYSTEM = `You are reading somebody's personality test result against their own notes,
the private notes they keep in a vault. They want to know where the test
agrees with what they have written about themselves and where it clashes.

You are given the result and up to fifteen of their notes, each labelled N1,
N2 and so on. Some are notes about themselves; some only came up because their
subject is near a trait.

WHAT A POINT IS. One agreement or one clash between the result and one note.
Say what the test says and what the note says, specifically enough that they
recognise the note: quote or closely paraphrase the line that matters. Name
the note by its label in the note field, never in the text.

ONLY WHAT THE NOTE SAYS ABOUT THEM. A note about introversion in general says
nothing about whether they are introverted. A note in their own voice about
how parties tire them does. Skip notes that are only about a subject.

CLASHES MATTER MOST. A quiet contradiction, such as a high score for being
organised beside a note about never finishing plans, is worth more than three
agreements. Do not soften a clash into an agreement.

FEW AND REAL. Three to eight points. If the notes say too little about them to
compare, report no points rather than stretching.

VOICE. Write to them as "you", in plain sentences, one or two per point. No
praise, no hedging, no advice, no mention of being an AI or a model.`;

/** The result in words, as the prompt gives it. */
export function describeResult(
  result: PersonalityResult,
  others: readonly PersonalityResult[] = [],
  themes: TraitThemes | null = null,
): string {
  const lines: string[] = [];
  if (result.kind === 'big_five') {
    lines.push(`Big Five (IPIP 50-item), taken ${result.takenAt}. Scores out of 100:`);
    for (const factor of BIG_FIVE_FACTORS) {
      const words = FACTOR_WORDS[factor];
      const percent = factorPercent(result.scores[factor]);
      const lean = percent >= 60 ? `high: ${words.high}` : percent <= 40 ? `low: ${words.low}` : 'near the middle';
      const near = themes?.[factor]?.map((t) => t.name).join(', ');
      lines.push(`- ${words.name} ${percent} (${lean})${near ? `. Themes in their notes near it: ${near}` : ''}`);
    }
  } else {
    lines.push(`${result.testName}: ${result.typedValue}, taken ${result.takenAt}, typed in from a test taken elsewhere.`);
  }
  if (result.note) lines.push(`Their own line about it: ${result.note}`);
  const rest = others.filter((o) => o.id !== result.id);
  if (rest.length > 0) {
    lines.push('', 'Their other results, for context only:');
    for (const o of rest) {
      lines.push(
        o.kind === 'big_five'
          ? `- Big Five, ${o.takenAt}: ${BIG_FIVE_FACTORS.map((f) => `${FACTOR_WORDS[f].name} ${factorPercent(o.scores[f])}`).join(', ')}`
          : `- ${o.testName}: ${o.typedValue}, ${o.takenAt}`,
      );
    }
  }
  return lines.join('\n');
}

/** The user message: the result, then the notes by label. */
export function readPrompt(
  resultText: string,
  notes: readonly { note: CandidateNote; pinned: boolean }[],
): string {
  const lines = ['The result:', resultText, '', 'Their notes:'];
  notes.forEach(({ note, pinned }, i) => {
    lines.push(
      '',
      `${noteLabel(i)}: "${note.title}"`,
      clip(note.body, pinned ? PINNED_CHARS : NOTE_CHARS),
    );
  });
  lines.push('', `Call ${READ_TOOL} with the points.`);
  return lines.join('\n');
}

export const READ_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stance: { type: 'string', enum: ['agrees', 'clashes'] },
          note: { type: 'string', description: 'The label of the note the point rests on, such as N3.' },
          text: { type: 'string' },
        },
        required: ['stance', 'note', 'text'],
      },
    },
  },
  required: ['points'],
};

/**
 * The points from the tool's input, each tied to the note it names. A point
 * naming no note it was given, or with no text, is dropped; clashes come
 * first, and at most MAX_POINTS are kept. Null when the input is not the
 * tool's shape at all.
 */
export function pointsFrom(
  input: unknown,
  notes: readonly { note: CandidateNote }[],
): ReadPoint[] | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as { points?: unknown }).points;
  if (!Array.isArray(raw)) return null;
  const byLabel = new Map(notes.map(({ note }, i) => [noteLabel(i), note]));
  const points: ReadPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { stance, note, text } = item as Record<string, unknown>;
    if (stance !== 'agrees' && stance !== 'clashes') continue;
    if (typeof text !== 'string' || !text.trim()) continue;
    const found = typeof note === 'string' ? byLabel.get(note.trim().toUpperCase()) : undefined;
    if (!found) continue;
    points.push({
      stance,
      text: clip(text, POINT_CHARS),
      note: { id: found.id, title: found.title, path: found.path },
    });
  }
  const ordered = [
    ...points.filter((p) => p.stance === 'clashes'),
    ...points.filter((p) => p.stance === 'agrees'),
  ];
  return ordered.slice(0, MAX_POINTS);
}
