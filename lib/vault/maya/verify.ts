import { quoteInNote } from '@/lib/vault/map/rules';
import type { MayaMaterial } from './retrieve';
import { MAYA_MAX_POINTS, MAYA_QUESTION_MAX, type RawThought, type ThoughtLabels } from './thought-model';

/**
 * Checking Maya's thought against what it was given (plan #1284).
 *
 * The model is told the rules; this is where they hold whatever it did.
 *
 * - A quote from one of the person's notes must be in that note, character
 *   for character (quoteInNote), or the citation is dropped. The note itself
 *   is not a citation: a point about the note cites the person's other notes.
 * - An outside source's exact words are kept only when the web search the
 *   same call ran returned them (the cited passages; see citedSearchText).
 *   Otherwise the source stands on its gist, which is always a paraphrase.
 * - A claim ending in a question mark is dropped: Maya argues, it does not
 *   quiz.
 * - A point left with neither a verified note nor a source is dropped. A
 *   point with only outside sources is kept, because a strong source on a
 *   note with no near neighbours is still worth reading, but every point that
 *   cites the person's own notes ranks above it.
 * - At most MAYA_MAX_POINTS are kept, renumbered from 1. None is a valid
 *   thought.
 * - A synthesis is kept only when its two positions are a conflict the
 *   retrieval found (a tension or a 'contradicts' edge).
 */

export type MayaNoteCitation = {
  noteId: string;
  title: string;
  quote: string;
  /** What that note holds and how it bears on this one. */
  point: string;
};

export type MayaSource = {
  author: string;
  work: string;
  /** What the work says, in Maya's words. Always a paraphrase. */
  gist: string;
  /** The work's own words, only when the web search returned them. */
  exactText: string | null;
};

export type MayaPoint = {
  kind: 'point';
  rank: number;
  claim: string;
  argument: string;
  notes: MayaNoteCitation[];
  sources: MayaSource[];
};

export type MayaSynthesis = {
  kind: 'synthesis';
  positionIds: [string, string];
  positionNames: [string, string];
  resolution: string;
};

export type MayaThought = {
  /** The question the note is working on; never blank, at most MAYA_QUESTION_MAX. */
  question: string;
  points: MayaPoint[];
  synthesis: MayaSynthesis | null;
};

/** What verification took out, for logs and tests. */
export type VerifyReport = {
  droppedQuotes: number;
  droppedPoints: number;
  paraphrased: number;
  synthesisRefused: boolean;
};

const CLAIM_MAX = 400;
const ARGUMENT_MAX = 2_000;
const LINE_MAX = 800;
const RESOLUTION_MAX = 1_500;

function cap(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/** Whitespace closed up and curly quotes straightened, for comparing passages. */
export function normalisePassage(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when the passage is among what the search returned. */
export function foundInSearch(passage: string, searchText: readonly string[]): boolean {
  const wanted = normalisePassage(passage).replace(/^["']|["']$/g, '');
  if (wanted.length < 8) return false;
  return searchText.some((found) => normalisePassage(found).includes(wanted));
}

/** One line under MAYA_QUESTION_MAX, falling back to the note's title. */
export function cleanQuestion(question: string, fallback: string): string {
  const line = question.replace(/\s+/g, ' ').trim() || fallback.replace(/\s+/g, ' ').trim() || 'This note';
  if (line.length <= MAYA_QUESTION_MAX) return line;
  const cut = line.slice(0, MAYA_QUESTION_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAYA_QUESTION_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function verifyThought(
  raw: RawThought,
  labels: ThoughtLabels,
  material: MayaMaterial,
  searchText: readonly string[],
): { thought: MayaThought; report: VerifyReport } {
  const report: VerifyReport = { droppedQuotes: 0, droppedPoints: 0, paraphrased: 0, synthesisRefused: false };

  const kept: MayaPoint[] = [];
  for (const point of raw.points) {
    const claim = cap(point.claim, CLAIM_MAX);
    if (!claim || claim.endsWith('?')) {
      report.droppedPoints += 1;
      continue;
    }

    const notes: MayaNoteCitation[] = [];
    for (const citation of point.notes) {
      const noteId = labels.notes.get(citation.note.toUpperCase());
      const note = noteId && noteId !== material.note.id ? material.bodies.get(noteId) : undefined;
      const quote = note ? quoteInNote(citation.quote, note.body) : null;
      if (!note || !quote) {
        report.droppedQuotes += 1;
        continue;
      }
      notes.push({ noteId: note.id, title: note.title, quote, point: cap(citation.point, LINE_MAX) });
    }

    const sources: MayaSource[] = point.sources.map((source) => {
      const exact = source.exact_text?.trim() ?? '';
      const verified = exact !== '' && foundInSearch(exact, searchText);
      if (exact !== '' && !verified) report.paraphrased += 1;
      return {
        author: cap(source.author, 200),
        work: cap(source.work, 300),
        gist: cap(source.gist, LINE_MAX),
        exactText: verified ? cap(exact, LINE_MAX) : null,
      };
    });

    if (notes.length === 0 && sources.length === 0) {
      report.droppedPoints += 1;
      continue;
    }
    kept.push({ kind: 'point', rank: point.rank, claim, argument: cap(point.argument, ARGUMENT_MAX), notes, sources });
  }

  // Own-note points first, each group in the model's order of rank.
  const ordered = kept
    .map((point, index) => ({ point, index }))
    .sort(
      (a, b) =>
        Number(b.point.notes.length > 0) - Number(a.point.notes.length > 0) ||
        a.point.rank - b.point.rank ||
        a.index - b.index,
    )
    .map(({ point }) => point);
  report.droppedPoints += Math.max(0, ordered.length - MAYA_MAX_POINTS);
  const points = ordered.slice(0, MAYA_MAX_POINTS).map((point, index) => ({ ...point, rank: index + 1 }));

  return {
    thought: {
      question: cleanQuestion(raw.question, material.note.title),
      points,
      synthesis: verifySynthesis(raw, labels, material, report),
    },
    report,
  };
}

function verifySynthesis(
  raw: RawThought,
  labels: ThoughtLabels,
  material: MayaMaterial,
  report: VerifyReport,
): MayaSynthesis | null {
  if (!raw.synthesis) return null;
  const ids = [...new Set(raw.synthesis.positions.map((label) => labels.positions.get(label.toUpperCase())))];
  const [left, right] = ids;
  const conflicting =
    ids.length === 2 &&
    !!left &&
    !!right &&
    material.conflicts.some(
      (c) => (c.leftId === left && c.rightId === right) || (c.leftId === right && c.rightId === left),
    );
  const resolution = cap(raw.synthesis.resolution, RESOLUTION_MAX);
  if (!conflicting || !resolution) {
    report.synthesisRefused = true;
    return null;
  }
  const name = (id: string) => material.positions.find((p) => p.id === id)?.name ?? '';
  return { kind: 'synthesis', positionIds: [left, right], positionNames: [name(left), name(right)], resolution };
}
