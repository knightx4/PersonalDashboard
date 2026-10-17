import { z } from 'zod';
import { isHeld, questionFormat, type CellStatus } from '@/lib/learn/levels/model';

/**
 * The cells a piece of a learning goal's plan teaches (plan #2138.13,
 * LEARN-LESSONS-SPEC "A piece names the cells it teaches"). Pure, so the
 * prompt, the reading of the reply and the choice of the check's cell are
 * tested without a model or a database.
 *
 * A piece is written from the claims graph's ideas; the territory is cells
 * (a topic at a level). Each piece names the cells of its goal's territory
 * that its ideas teach, and its check is a question on one of them, so
 * passing it moves the topic ladder.
 */

/** Cells offered to the matcher for one unit, at most. */
export const TERRITORY_CELLS_MAX = 60;

/** Cells one piece may name, at most. */
export const PIECE_CELLS_MAX = 4;

/** One cell of the goal's territory, as the matcher and the page are given it. */
export type TerritoryCell = {
  id: string;
  topicId: string;
  topicName: string;
  level: number;
  descriptor: readonly string[];
};

/** One piece, as the matcher is given it. */
export type PieceToMatch = {
  title: string;
  ideas: readonly { name: string; claim: string }[];
};

/**
 * The cells a goal's territory offers: each topic's cells up to the target
 * the goal's lens sets on it, lowest topic name first and lowest level first,
 * at most `TERRITORY_CELLS_MAX`. A topic named twice keeps its higher target.
 */
export function territoryCells(
  targets: readonly { topicId: string; targetLevel: number }[],
  cells: readonly TerritoryCell[],
): TerritoryCell[] {
  const target = new Map<string, number>();
  for (const t of targets) target.set(t.topicId, Math.max(target.get(t.topicId) ?? 0, t.targetLevel));
  return cells
    .filter((cell) => cell.level <= (target.get(cell.topicId) ?? 0))
    .sort((a, b) => a.topicName.localeCompare(b.topicName) || a.topicId.localeCompare(b.topicId) || a.level - b.level)
    .slice(0, TERRITORY_CELLS_MAX);
}

/** The matcher's message: the unit's pieces, numbered, and the cells, keyed C1, C2, … */
export function pieceCellsPrompt(input: {
  trackName: string;
  unitTitle: string;
  pieces: readonly PieceToMatch[];
  cells: readonly TerritoryCell[];
  tool: string;
}): string {
  return [
    `Track: ${input.trackName.trim()}`,
    `Unit: ${input.unitTitle.trim()}`,
    '',
    'The pieces of the unit, numbered, with the ideas each teaches:',
    ...input.pieces.flatMap((piece, index) => [
      `${index + 1}. ${piece.title.trim()}`,
      ...piece.ideas.map((idea) => `   - ${idea.name}: ${idea.claim}`),
    ]),
    '',
    'The levels of understanding on offer, each a topic at a level with what meeting it looks like:',
    ...input.cells.map(
      (cell, index) => `C${index + 1}. ${cell.topicName}, level ${cell.level}: ${cell.descriptor.join('; ')}`,
    ),
    '',
    `Call ${input.tool}.`,
  ].join('\n');
}

const keyList = z.preprocess(
  (value) => (typeof value === 'string' ? value.split(/[\s,]+/).filter(Boolean) : value),
  z.array(z.union([z.string(), z.number()])),
);

const replySchema = z.object({
  pieces: z.array(z.object({ piece: z.coerce.number(), cells: keyList })),
});

/**
 * The cell ids each piece names, in piece order. A key outside the list is
 * ignored, a cell named twice on one piece counts once, and a piece keeps at
 * most `PIECE_CELLS_MAX`. A piece the reply leaves out names none. Null when
 * the reply is not the shape asked for.
 */
export function readPieceCells(
  input: unknown,
  pieceCount: number,
  cells: readonly TerritoryCell[],
): string[][] | null {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return null;
  const out: string[][] = Array.from({ length: pieceCount }, () => []);
  for (const row of parsed.data.pieces) {
    if (!Number.isInteger(row.piece) || row.piece < 1 || row.piece > pieceCount) continue;
    const list = out[row.piece - 1]!;
    for (const key of row.cells) {
      const n = Number(String(key).replace(/^\s*C/i, ''));
      const cell = Number.isInteger(n) ? cells[n - 1] : undefined;
      if (!cell || list.includes(cell.id) || list.length >= PIECE_CELLS_MAX) continue;
      list.push(cell.id);
    }
  }
  return out;
}

/** A cell the piece names, with where the person stands on it. */
export type PieceCellView = {
  cellId: string;
  topicId: string;
  topicName: string;
  level: number;
  status: CellStatus;
};

/**
 * The cell a piece's check asks about: the level the piece reaches. Of the
 * piece's cells that can be asked in writing (an explanation or a case, so
 * not level 10's defence), the highest level, preferring one the person does
 * not hold yet, then the order the piece names them in. Null when none can be
 * asked, and the piece falls back to its own written question.
 */
export function checkCell(cells: readonly PieceCellView[]): PieceCellView | null {
  const askable = cells.filter((cell) => questionFormat(cell.level) !== 'defend');
  if (askable.length === 0) return null;
  const top = Math.max(...askable.map((cell) => cell.level));
  const atTop = askable.filter((cell) => cell.level === top);
  return atTop.find((cell) => !isHeld(cell.status)) ?? atTop[0]!;
}

/**
 * The cell a held piece's check asks about (plan #2292.5): one level above
 * what the placement showed. On each topic the piece's cells sit on, the
 * level above the highest held one; of those, the lowest cell that can be
 * asked in writing and is not held yet, then the order the piece names its
 * topics in. `ladder` is every cell of those topics, with where you stand on
 * each. Null when every topic is held to its top, and the piece asks as any
 * piece does.
 */
export function aboveHeldCell(
  cells: readonly PieceCellView[],
  ladder: readonly PieceCellView[],
): PieceCellView | null {
  const topics = [...new Set(cells.map((cell) => cell.topicId))];
  const candidates = topics.flatMap((topicId) => {
    const own = cells.filter((cell) => cell.topicId === topicId && isHeld(cell.status));
    if (own.length === 0) return [];
    const heldTo = Math.max(...own.map((cell) => cell.level));
    const above = ladder
      .filter(
        (cell) =>
          cell.topicId === topicId &&
          cell.level > heldTo &&
          !isHeld(cell.status) &&
          questionFormat(cell.level) !== 'defend',
      )
      .sort((a, b) => a.level - b.level);
    return above.length > 0 ? [above[0]!] : [];
  });
  if (candidates.length === 0) return null;
  const lowest = Math.min(...candidates.map((cell) => cell.level));
  return candidates.find((cell) => cell.level === lowest)!;
}

/**
 * The cell the piece's check asks about: for a piece a placement found held,
 * the level above what was shown, falling back to the piece's own cells;
 * otherwise the level the piece reaches (`checkCell`).
 */
export function pieceCheckCell(
  cells: readonly PieceCellView[],
  ladder: readonly PieceCellView[],
  held: boolean,
): PieceCellView | null {
  return (held ? aboveHeldCell(cells, ladder) : null) ?? checkCell(cells);
}
