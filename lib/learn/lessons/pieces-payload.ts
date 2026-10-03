import { z } from 'zod';
import { curriculumRows, type UnitGoal } from '@/lib/learn/graph/curriculum-view';
import { learningOrder, prerequisiteMap, type Concept, type Graph } from '@/lib/learn/graph/model';
import { beneath } from './unit-check';

/**
 * Splitting a unit into pieces (plan #1140, LEARN-LESSONS-SPEC "A goal's
 * units are split into pieces"). Pure, so the rules are tested without a
 * database or a model.
 *
 * A piece is one sitting of about 20 to 30 minutes covering a few of the
 * unit's ideas. The ideas are the unit's own: its goals and everything they
 * rest on that no earlier unit's goals also rest on, whatever the person
 * knows of them, which is the rule the unit check uses less its filter on
 * state. Each idea falls in exactly one piece.
 */

/** Pieces a unit is split into, when it has at least this many ideas. */
export const PIECES_MIN = 3;
export const PIECES_MAX = 6;

const MAX_TITLE = 80;

/**
 * How many pieces a unit with `ideas` ideas gets: 3 to 6, but never more than
 * it has ideas, so a unit of two ideas is two pieces of one.
 */
export function piecesBounds(ideas: number): { min: number; max: number } {
  return { min: Math.min(PIECES_MIN, ideas), max: Math.min(PIECES_MAX, ideas) };
}

type TrackForPieces = {
  units: readonly { id: string }[];
  goals: readonly UnitGoal[];
  graph: Graph;
};

/**
 * The unit's own ideas in learning order, prerequisites first. Empty for a
 * unit that is not laid out (no goal filed under it resolved to an idea) or
 * whose ideas all belong to earlier units.
 */
export function unitIdeas(track: TrackForPieces, unitId: string): Concept[] {
  const { rows } = curriculumRows([...track.units], [...track.goals], track.graph);
  const index = rows.findIndex((row) => row.unit.id === unitId);
  if (index < 0) return [];
  const row = rows[index]!;
  if (row.goals.length === 0) return [];

  const prerequisites = prerequisiteMap(track.graph);
  const goalIds = (goals: typeof row.goals) => goals.map((goal) => goal.conceptId!);
  const earlier = beneath(
    rows.slice(0, index).flatMap((before) => goalIds(before.goals)),
    prerequisites,
  );
  const own = [...beneath(goalIds(row.goals), prerequisites)].filter((id) => !earlier.has(id));
  return learningOrder(track.graph, own);
}

export type PieceIdea = { name: string; claim: string; buildsOn: number[] };

/** Each idea with the numbers (from 1) of the listed ideas it builds on. */
export function numberIdeas(ideas: readonly Concept[], graph: Graph): PieceIdea[] {
  const position = new Map(ideas.map((idea, index) => [idea.id, index + 1]));
  const prerequisites = prerequisiteMap(graph);
  return ideas.map((idea) => ({
    name: idea.name,
    claim: idea.claim,
    buildsOn: (prerequisites.get(idea.id) ?? [])
      .flatMap((id) => (position.has(id) ? [position.get(id)!] : []))
      .sort((a, b) => a - b),
  }));
}

/** The prompt for one unit's pieces. Exported so its content is tested without a model. */
export function piecesPrompt(input: {
  trackName: string;
  unit: { title: string; covers: string | null; outcome: string | null };
  ideas: readonly PieceIdea[];
}): string {
  const bounds = piecesBounds(input.ideas.length);
  const count =
    bounds.min === bounds.max
      ? `Split it into ${bounds.min} ${bounds.min === 1 ? 'piece' : 'pieces'}.`
      : `Split it into between ${bounds.min} and ${bounds.max} pieces.`;
  return [
    `The track: ${input.trackName}`,
    `The unit: ${input.unit.title}`,
    ...(input.unit.covers ? [`It covers: ${input.unit.covers}`] : []),
    ...(input.unit.outcome ? [`Its outcome: ${input.unit.outcome}`] : []),
    '',
    `Its ${input.ideas.length} ideas, numbered, in an order where each comes after what it builds on:`,
    ...input.ideas.map(
      (idea, index) =>
        `${index + 1}. ${idea.name}: ${idea.claim}${idea.buildsOn.length > 0 ? ` (builds on ${idea.buildsOn.join(', ')})` : ''}`,
    ),
    '',
    count,
    '',
    'Call report_pieces.',
  ].join('\n');
}

export type WrittenPiece = { title: string; ideas: number[] };

export type PiecesResult = { ok: true; pieces: WrittenPiece[] } | { ok: false; detail: string };

/**
 * A list as the model sent it. The tool is not strict, and Sonnet hands a
 * nested list back as a JSON string, or as the one object when the unit has a
 * single piece, which is the shape the feed cards met (lib/learn/feed/write-card.ts).
 * The pass retried such a unit every hour: 33 calls on 2 October, most of
 * them a reply of about 70 tokens for a one-piece unit. Both are read as the
 * list; anything else is left for the schema to refuse.
 */
function listOf(value: unknown): unknown {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return value;
    }
  }
  if (list && typeof list === 'object' && !Array.isArray(list)) return [list];
  return list;
}

/** An idea's number, also when it comes back as a string ("3"). */
const ideaNumber = z.preprocess(
  (value) => (typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value),
  z.number(),
);

/** The idea numbers, also as one number or a string of them ("1, 2"). */
function numberList(value: unknown): unknown {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') {
    const parts = value.replace(/^\s*\[|\]\s*$/g, '').split(/[\s,]+/).filter(Boolean);
    if (parts.length > 0 && parts.every((part) => /^\d+$/.test(part))) return parts.map(Number);
  }
  return value;
}

const payloadSchema = z.object({
  pieces: z.preprocess(
    listOf,
    z.array(z.object({ title: z.string(), ideas: z.preprocess(numberList, z.array(ideaNumber)) })),
  ),
});

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The pieces the model reported, as numbers into the unit's ideas.
 *
 * An idea named twice stays in the first piece that named it, and a number
 * outside the list is ignored. An idea the model left out goes into the piece
 * holding the idea before it (the start of the first piece, for the first
 * idea), so every
 * idea is in a piece without paying for the call again. A piece left with no
 * ideas or no title is dropped. Too few or too many pieces fails the call.
 */
export function readPieces(input: unknown, ideaCount: number): PiecesResult {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    // Name the field, so the next refusal says what the reply looked like.
    const where = parsed.error.issues.map((issue) => issue.path.join('.') || 'the report').join(', ');
    return { ok: false, detail: `The pieces did not match their schema (${where}).` };
  }

  const taken = new Set<number>();
  const pieces: WrittenPiece[] = [];
  for (const raw of parsed.data.pieces) {
    const title = clean(raw.title).slice(0, MAX_TITLE).trim();
    const ideas = raw.ideas.filter(
      (number) => Number.isInteger(number) && number >= 1 && number <= ideaCount && !taken.has(number),
    );
    const unique = [...new Set(ideas)];
    if (!title || unique.length === 0) continue;
    for (const number of unique) taken.add(number);
    pieces.push({ title, ideas: unique });
  }
  if (pieces.length === 0) return { ok: false, detail: 'The pieces came back with none usable.' };

  for (let number = 1; number <= ideaCount; number += 1) {
    if (taken.has(number)) continue;
    const before = pieces.find((piece) => piece.ideas.includes(number - 1));
    if (before) before.ideas.splice(before.ideas.indexOf(number - 1) + 1, 0, number);
    else pieces[0]!.ideas.unshift(number);
    taken.add(number);
  }

  const bounds = piecesBounds(ideaCount);
  if (pieces.length < bounds.min || pieces.length > bounds.max) {
    return { ok: false, detail: `The unit came back in ${pieces.length} ${pieces.length === 1 ? 'piece' : 'pieces'}.` };
  }
  return { ok: true, pieces };
}
