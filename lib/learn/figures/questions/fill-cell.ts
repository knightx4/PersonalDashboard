import { z } from 'zod';
import type { FigureQuestionForm, FigureQuestionVerdict } from '../types';

/**
 * Fill the cell (plan #2321.5): a table with one cell left blank, and a short
 * typed answer for what goes in it. The writer writes the whole table and
 * names the cell; the blank shows as a question mark and the cell's text is
 * the answer.
 *
 * Graded here when the answer is plainly right or plainly wrong: the same
 * text, or the same number whatever its symbols. Anything else (a cell of
 * words said another way, a number near the answer) goes to the model with
 * the table in its prompt.
 */

/** What a blank cell shows. FigureGrid reads it as neither number nor text, so the column keeps its alignment. */
export const BLANK_CELL = '?';

const askSchema = z.object({
  /** The row of the blank, counting from 0 below the header. */
  row: z.number().int().min(0),
  /** Its column, counting from 0. */
  column: z.number().int().min(0),
  /** The question, one sentence: what the blank is and what to work out. */
  prompt: z.string().trim().min(10).max(300),
});

export type FillCellAsk = z.infer<typeof askSchema>;

type Grid = { columns: string[]; rows: string[][] };

/** Lower case, single spaces, no full stop at the end. */
function plain(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

/** The number a cell says, whatever its currency, commas, spaces or per cent sign; null when it says words. */
export function cellNumber(text: string): number | null {
  const bare = text.replace(/[\s,£$€%]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^[-+]?\d*\.?\d+$/.test(bare)) return null;
  const value = Number(bare);
  return Number.isFinite(value) ? value : null;
}

/** Within this share of the answer is the same number, so 324 and 324.0 and £324 all count. */
const SAME_NUMBER = 0.005;
/** Further than this from the answer is plainly wrong. Between the two the model reads it. */
const WRONG_NUMBER = 0.05;

export function gradeCell(answer: string, response: string): FigureQuestionVerdict {
  if (plain(answer) === plain(response)) return 'met';
  const expected = cellNumber(answer);
  const given = cellNumber(response);
  if (expected === null || given === null) return null;
  const off = Math.abs(given - expected) / Math.max(Math.abs(expected), 1e-9);
  if (off <= SAME_NUMBER) return 'met';
  if (off > WRONG_NUMBER) return 'not_met';
  return null;
}

/** The form for any kind drawn as a grid of columns and rows: the table, and later kinds of the same shape. */
export function fillCellForm<Spec extends Grid>(): FigureQuestionForm<Spec, unknown, FillCellAsk> {
  return {
    id: 'fill_cell',
    label: 'Fill the cell',
    writerLine:
      'fill_cell: the table with one cell left blank, for a level whose checks are about working a figure out or knowing what goes where: a missing total, the step of a calculation, the term that belongs in a row. ask is {"row": the blank cell\'s row counting from 0 below the header, "column": its column counting from 0, "prompt": one sentence saying what the blank is and what to work out}. Blank a cell the rest of the table lets them work out or that the level says they should know, never the row\'s name, and write the cell itself in full in the spec; it is hidden from them and is the answer.',
    schema: askSchema,
    pose({ spec, ask }) {
      const row = spec.rows[ask.row];
      const cell = row?.[ask.column];
      if (!row || cell === undefined || ask.column >= spec.columns.length) return null;
      if (cell.trim() === '' || cell.trim() === BLANK_CELL) return null;
      const rows = spec.rows.map((cells, r) => (r === ask.row ? cells.map((text, c) => (c === ask.column ? BLANK_CELL : text)) : cells));
      return { spec: { ...spec, rows }, prompt: ask.prompt, answer: cell.trim() };
    },
    grade: gradeCell,
    example: { row: 1, column: 2, prompt: 'What does the café take in a day at £3.60?' },
  };
}
