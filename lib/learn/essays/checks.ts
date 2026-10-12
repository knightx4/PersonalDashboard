/**
 * The named checks an essay can be run through, and the rules for the margin
 * notes they raise (plan #1869; docs/LEARN-ESSAYS-SPEC.md, "Margin notes and
 * checks" and "What Dash does, and how far it goes").
 *
 * Each check is one instruction. A model check makes one Sonnet call per
 * paragraph it reads (checks-model.ts), and the call writes the whole ladder
 * for what it finds, so Help climbs a rung without another call. The writing
 * guide check is local (checks-local.ts): the rules in lib/writing/check.ts,
 * costing nothing and raising a marker alone.
 *
 * Pure, so tested, and read by the page as well as the server.
 */

import { noteHref } from '@/lib/vault/paths';
import { locateAnchor, makeAnchor, type Anchor } from './anchor';

export const CHECK_IDS = [
  'the_claim',
  'so_what',
  'counterpoint',
  'missing_step',
  'fact_to_verify',
  'already_said',
  'earned_ending',
  'writing_guide',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/**
 * What a model check reads: the whole essay in one call, each paragraph in a
 * call of its own, or the last paragraph alone.
 */
export type CheckScope = 'whole' | 'each' | 'last';

export type EssayCheck = {
  id: CheckId;
  name: string;
  kind: 'model' | 'local';
  scope: CheckScope;
  /** One line in the rail under the check's name. */
  blurb: string;
  /** What the model is asked to look for, as one instruction. Empty for a local check. */
  instruction: string;
};

/**
 * In the order the spec suggests revising in: claim and focus, then evidence
 * and reasoning, then structure, then language.
 */
export const ESSAY_CHECKS: readonly EssayCheck[] = [
  {
    id: 'the_claim',
    name: 'The Claim',
    kind: 'model',
    scope: 'whole',
    blurb: 'Is there one claim, and is it the one in your brief?',
    instruction:
      'Find whether the essay argues one claim, and whether it is the claim in the brief. Raise a problem only if ' +
      'there is no single claim, two claims compete, or the claim argued is not the one in the brief. Quote the ' +
      'sentence that comes nearest to stating the claim.',
  },
  {
    id: 'so_what',
    name: 'So What',
    kind: 'model',
    scope: 'whole',
    blurb: 'Would your reader care, and does the essay say why?',
    instruction:
      'Read the essay as the reader named in the brief. Raise a problem only if that reader would finish it ' +
      'without knowing why it matters to them. Quote the place where saying so would help most.',
  },
  {
    id: 'counterpoint',
    name: 'Counterpoint',
    kind: 'model',
    scope: 'each',
    blurb: 'The strongest objection a paragraph does not answer.',
    instruction:
      'Find the strongest objection a thoughtful reader who disagrees would raise against this paragraph, which ' +
      'neither this paragraph nor the rest of the essay answers. Raise nothing if the paragraph makes no claim ' +
      'worth disputing or the essay already answers the objection. Quote the sentence the objection is aimed at.',
  },
  {
    id: 'missing_step',
    name: 'Missing Step',
    kind: 'model',
    scope: 'each',
    blurb: 'A step in the argument the reader has to supply.',
    instruction:
      'Find a step in the argument of this paragraph that the reader has to supply themselves: a conclusion that ' +
      'does not follow from what came before without something unsaid. Raise nothing if every step is there. ' +
      'Quote the sentence that jumps.',
  },
  {
    id: 'fact_to_verify',
    name: 'Fact to Verify',
    kind: 'model',
    scope: 'each',
    blurb: 'Claims of fact that need a source and have none.',
    instruction:
      'Find a claim of fact in this paragraph (a figure, a date, a finding, a historical event, what someone said) ' +
      'that a careful reader would want a source for and that has none. Opinions and common knowledge do not ' +
      'count. Quote the claim.',
  },
  {
    id: 'already_said',
    name: 'Already Said',
    kind: 'model',
    scope: 'each',
    blurb: 'Where the essay repeats or contradicts your own notes.',
    instruction:
      'Compare this paragraph with the writer\'s own notes given below it. Raise a problem only if the paragraph ' +
      'contradicts something a note says, or repeats a note so closely that the writer should link to it or ' +
      'build on it. Name the note by its number. Quote the sentence concerned.',
  },
  {
    id: 'earned_ending',
    name: 'Earned Ending',
    kind: 'model',
    scope: 'last',
    blurb: 'Does the ending follow from what came before it?',
    instruction:
      'Read the last paragraph against the rest of the essay. Raise a problem only if the conclusion claims more ' +
      'than the essay showed, brings in something new, or does not follow from the argument. Quote the sentence ' +
      'that overreaches.',
  },
  {
    id: 'writing_guide',
    name: 'Writing guide',
    kind: 'local',
    scope: 'each',
    blurb: 'Inflated contrast, dashes for rhythm and stock phrases. Free.',
    instruction: '',
  },
];

export function checkById(id: string): EssayCheck | null {
  return ESSAY_CHECKS.find((check) => check.id === id) ?? null;
}

/** The check's name as the rail shows it, for a stored check_name. */
export function checkName(id: string): string {
  return checkById(id)?.name ?? id.replace(/_/g, ' ');
}

/** At most this many notes are open at once; more wait their turn. */
export const OPEN_AT_ONCE = 3;

/** A check dismissed this many times in one essay does not run on it again. */
export const DISMISSALS_TO_STOP = 2;

/** A paragraph needs this many words to be checked on its own. */
export const PARAGRAPH_MIN_WORDS = 6;

/** The most paragraphs one run reads, so a pasted book does not cost a book. */
export const PARAGRAPHS_MAX = 40;

/** The longest essay a model check reads, in characters: about 4,000 words. */
export const CHECK_ESSAY_MAX = 24_000;

export type Paragraph = { from: number; to: number; text: string };

function words(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * The essay's paragraphs: runs of lines between blank lines, leaving out
 * headings, fenced code and anything too short to argue something.
 */
export function essayParagraphs(doc: string): Paragraph[] {
  const out: Paragraph[] = [];
  const pattern = /[^\n]+(?:\n(?![ \t]*\n)[^\n]*)*/g;
  for (let m = pattern.exec(doc); m; m = pattern.exec(doc)) {
    const raw = m[0];
    const lead = raw.match(/^\s*/)![0].length;
    const text = raw.trim();
    if (!text || /^#{1,6}\s/.test(text) || text.startsWith('```')) continue;
    if (words(text) < PARAGRAPH_MIN_WORDS) continue;
    out.push({ from: m.index + lead, to: m.index + lead + text.length, text });
  }
  return out;
}

/** The parts of the essay a check reads, one call each. Null stands for the whole essay. */
export function checkUnits(check: EssayCheck, doc: string): (Paragraph | null)[] {
  const paragraphs = essayParagraphs(doc);
  if (paragraphs.length === 0) return [];
  if (check.scope === 'whole') return [null];
  if (check.scope === 'last') return [paragraphs[paragraphs.length - 1]];
  return paragraphs.slice(0, PARAGRAPHS_MAX);
}

/**
 * How many calls a run of the check makes on a draft with this many
 * paragraphs, for its $ hint. Already Said may make fewer, skipping a
 * paragraph none of your notes is near.
 */
export function checkCalls(check: EssayCheck, paragraphs: number): number {
  if (check.kind !== 'model' || paragraphs === 0) return 0;
  return check.scope === 'each' ? Math.min(paragraphs, PARAGRAPHS_MAX) : 1;
}

/** What a run of a check found: where, and the ladder of what to say about it. */
export type Finding = {
  anchor: Anchor;
  /** Rungs 1 to 3: the question, the hint, the directions. */
  ladder: [string, string, string];
  why: string;
  /** The rung the note opens on: 1 for a model check, 0 (a marker) for a local one. */
  rung: number;
};

const TEXT_MAX = 600;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX) : '';
}

/** The JSON object in a reply, with or without a code fence around it. */
function jsonIn(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** The range of the first sentence of a paragraph, for a finding whose quote cannot be found. */
function firstSentence(paragraph: Paragraph): { from: number; to: number } {
  const m = paragraph.text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const length = m ? m[0].length : paragraph.text.length;
  return { from: paragraph.from, to: paragraph.from + length };
}

/** Notes the model compared a paragraph with, numbered from 1 as it saw them. */
export type ComparedNote = { path: string; title: string; text: string };

/**
 * The finding in a model's reply, anchored in the draft, or null for none.
 * The quote is looked for in the paragraph the call read (the whole draft
 * for a whole-essay check): exactly, then as a passage most like it. A quote
 * that cannot be placed in a paragraph falls back to its first sentence; on a
 * whole-essay check it is dropped, since there is nowhere sure to put it.
 * Already Said names a note by number, and a link to it goes into the hint.
 */
export function readFinding(
  reply: string,
  doc: string,
  unit: Paragraph | null,
  notes: readonly ComparedNote[] = [],
): Finding | null {
  const parsed = jsonIn(reply) as { finding?: unknown } | null;
  if (!parsed || typeof parsed !== 'object') return null;
  const found = parsed.finding as Record<string, unknown> | null | undefined;
  if (!found || typeof found !== 'object') return null;
  const question = clean(found.question);
  const hint = clean(found.hint);
  const directions = clean(found.directions);
  const why = clean(found.why);
  if (!question || !hint) return null;

  const scope = unit ?? { from: 0, to: doc.length, text: doc };
  const area = doc.slice(scope.from, scope.to);
  const quote = typeof found.quote === 'string' ? found.quote.trim() : '';
  let range: { from: number; to: number } | null = null;
  if (quote) {
    const at = locateAnchor(area, { quote, prefix: '', suffix: '', offset: null });
    if (at) range = { from: scope.from + at.from, to: scope.from + at.to };
  }
  if (!range) {
    if (!unit) return null;
    range = firstSentence(unit);
  }

  let linked = hint;
  const index = typeof found.note === 'number' ? found.note : Number(found.note);
  const note = Number.isInteger(index) ? notes[index - 1] : undefined;
  if (note) linked = `${hint} See [${note.title.replace(/[[\]]/g, '')}](${noteHref(note.path)}).`;

  return {
    anchor: makeAnchor(doc, range.from, range.to),
    ladder: [question, linked, directions || hint],
    why: why || question,
    rung: 1,
  };
}

/** A margin note as the rules below read it. */
export type NoteState = {
  id: string;
  checkName: string;
  status: 'open' | 'waiting' | 'done' | 'dismissed' | 'detached';
  quote: string;
  createdAt: string;
};

/** Checks the person has dismissed twice in this essay, which do not run on it again. */
export function stoppedChecks(notes: readonly Pick<NoteState, 'checkName' | 'status'>[]): Set<string> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (note.status === 'dismissed') counts.set(note.checkName, (counts.get(note.checkName) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= DISMISSALS_TO_STOP).map(([id]) => id));
}

/**
 * The findings worth raising: one per place, and none at a place this check
 * has already raised a note on, whatever became of it, so a run repeated
 * after a dismissal does not raise the same note again.
 */
export function freshFindings(check: string, found: readonly Finding[], notes: readonly NoteState[]): Finding[] {
  const seen = new Set(notes.filter((note) => note.checkName === check).map((note) => note.quote.trim()));
  const out: Finding[] = [];
  for (const finding of found) {
    const key = finding.anchor.quote.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

/** The status each new note takes: open while fewer than three are, waiting after. */
export function newStatuses(openNow: number, count: number): ('open' | 'waiting')[] {
  const room = Math.max(0, OPEN_AT_ONCE - openNow);
  return Array.from({ length: count }, (_, i) => (i < room ? 'open' : 'waiting'));
}

/** The waiting notes to open now that some have closed, oldest first. */
export function notesToOpen(notes: readonly NoteState[]): string[] {
  const open = notes.filter((note) => note.status === 'open').length;
  const room = Math.max(0, OPEN_AT_ONCE - open);
  return notes
    .filter((note) => note.status === 'waiting')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, room)
    .map((note) => note.id);
}

/** What a note says on a rung: nothing on rung 0, its ladder entry on 1 to 3. */
export function bodyAt(ladder: readonly string[], rung: number): string {
  if (rung <= 0) return '';
  return ladder[Math.min(rung, 3) - 1] ?? ladder[ladder.length - 1] ?? '';
}

/**
 * Help's next rung, or null when the note is on rung 3 and the next is a
 * suggested wording (rung 4), which goes through Rephrase on the note's text.
 */
export function nextRung(rung: number): number | null {
  return rung < 3 ? rung + 1 : null;
}

