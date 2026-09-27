import { z } from 'zod';
import { pieceLines, type PieceForCheck } from './piece-check';
import { MAX_POINTS, readPointMarks, type HandedFigure } from './point-marks';

/**
 * A piece's practice task (plan #1142, LEARN-LESSONS-SPEC "A piece has a
 * practice task"). Pure, so the prompt and the rules are tested without a
 * model or a database.
 *
 * One hands-on task between a piece's lessons and its check, handed in by
 * typing into the page: named key figures where the work ends in numbers,
 * and written working. The task lists the points a complete hand-in has, and
 * a hand-in passes when every point is met. A piece is passed only when its
 * practice and its check both are.
 */

/** Figures a task may ask for by name, at most. */
export const MAX_FIGURES = 6;
/** The size of the table a task may give. */
export const MAX_COLUMNS = 8;
export const MAX_ROWS = 12;
/** Longest value typed for one figure, and longest written working. */
export const FIGURE_VALUE_MAX = 200;
export const ANSWER_MAX = 4000;

/** A figure the task asks to be typed in. `unit` is shown beside the box. */
export type FigureAsk = { label: string; unit: string | null };

/** A small table the task works from. */
export type PracticeTable = { columns: string[]; rows: string[][] };

/** One lesson of the piece, as the task's writer is given it. */
export type LessonForPractice = { name: string; takeaway: string | null; example: string | null };

/** The writer's message: the piece, its lessons where written, and the tool to call. */
export function practicePrompt(piece: PieceForCheck, lessons: readonly LessonForPractice[], tool: string): string {
  const taught = lessons.filter((lesson) => lesson.takeaway || lesson.example);
  return [
    ...pieceLines(piece),
    ...(taught.length > 0
      ? [
          '',
          'What the lessons taught:',
          ...taught.flatMap((lesson) => [
            `- ${lesson.name}: ${lesson.takeaway?.trim() ?? ''}`.trimEnd(),
            ...(lesson.example ? [`  Example used: ${lesson.example.trim()}`] : []),
          ]),
        ]
      : []),
    '',
    `Call ${tool}.`,
  ].join('\n');
}

/** What the writer reports through its tool. */
export const practicePayloadSchema = z.object({
  task: z.string(),
  columns: z.array(z.string()).optional(),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
  figures: z.array(z.object({ label: z.string(), unit: z.string().optional().nullable() })).optional(),
  points: z.array(z.string()),
  worked: z.string(),
  spreadsheet_note: z.string().optional().nullable(),
});

export type PracticePayload = z.infer<typeof practicePayloadSchema>;

/** How much of the writer's report is kept: points, figures and the table's size. */
export type WrittenLimits = { points: number; figures: number; columns: number; rows: number };

export const PRACTICE_LIMITS: WrittenLimits = {
  points: MAX_POINTS,
  figures: MAX_FIGURES,
  columns: MAX_COLUMNS,
  rows: MAX_ROWS,
};

/** A task ready to store. */
export type WrittenPractice = {
  task: string;
  data: PracticeTable | null;
  figures: FigureAsk[];
  points: string[];
  worked: string;
  spreadsheetNote: string | null;
};

/**
 * The writer's report checked and tidied. A task with no text, no points or
 * no worked answer is refused; everything else is trimmed to fit: for a
 * piece's practice at most six points and six figures, a table of at most
 * eight columns and twelve rows with every row the width of the header, and
 * figures named once each. The final project passes larger limits.
 */
export function toWrittenPractice(
  payload: PracticePayload,
  limits: WrittenLimits = PRACTICE_LIMITS,
): { ok: true; practice: WrittenPractice } | { ok: false; reason: string } {
  const task = payload.task.trim();
  const worked = payload.worked.trim();
  if (task === '') return { ok: false, reason: 'The task came back empty.' };
  if (worked === '') return { ok: false, reason: 'The task came back without a worked answer.' };

  const points = payload.points.map((point) => point.trim()).filter(Boolean).slice(0, limits.points);
  if (points.length === 0) return { ok: false, reason: 'The task came back without the points it is marked on.' };

  const seen = new Set<string>();
  const figures: FigureAsk[] = [];
  for (const figure of payload.figures ?? []) {
    const label = figure.label.trim();
    const key = label.toLowerCase();
    if (label === '' || seen.has(key)) continue;
    seen.add(key);
    figures.push({ label, unit: figure.unit?.trim() || null });
    if (figures.length === limits.figures) break;
  }

  const columns = (payload.columns ?? []).map((column) => column.trim()).slice(0, limits.columns);
  const rows = (payload.rows ?? [])
    .slice(0, limits.rows)
    .map((row) => columns.map((_, index) => String(row[index] ?? '').trim()))
    .filter((row) => row.some((cell) => cell !== ''));
  const data = columns.length > 0 && rows.length > 0 ? { columns, rows } : null;

  return {
    ok: true,
    practice: {
      task,
      data,
      figures,
      points,
      worked,
      spreadsheetNote: payload.spreadsheet_note?.trim() || null,
    },
  };
}

/** The row as stored in learn.piece_practice. */
export type PracticeRow = {
  id: string;
  task: string;
  data: unknown;
  figures: unknown;
  points: string[];
  worked: string;
  spreadsheet_note: string | null;
};

/** The row as stored in learn.piece_practice_handins. */
export type HandInRow = {
  id: string;
  answer: string;
  figures: unknown;
  marks: unknown;
  passed: boolean;
  created_at: string;
};

export const PRACTICE_COLUMNS = 'id, task, data, figures, points, worked, spreadsheet_note';
export const HANDIN_COLUMNS = 'id, answer, figures, marks, passed, created_at';

/** One point's mark as the page shows it. The point itself stays on the server. */
export type MarkView = { met: boolean; note: string };

/** A hand-in as the page shows it. */
export type HandInView = {
  id: string;
  answer: string;
  figures: HandedFigure[];
  marks: MarkView[];
  passed: boolean;
};

/**
 * The task as the page is given it. The points and the worked answer name the
 * expected figures, so they stay on the server until the practice is passed.
 */
export type PracticeView = {
  id: string;
  task: string;
  data: PracticeTable | null;
  figures: FigureAsk[];
  spreadsheetNote: string | null;
  /** Shown once passed. */
  worked: string | null;
  passed: boolean;
  /** The latest hand-in, or null before the first. */
  latest: HandInView | null;
};

export function readTable(value: unknown): PracticeTable | null {
  if (!value || typeof value !== 'object') return null;
  const { columns, rows } = value as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null;
  const heads = columns.map((column) => String(column));
  const body = rows.filter(Array.isArray).map((row) => heads.map((_, index) => String((row as unknown[])[index] ?? '')));
  return heads.length > 0 && body.length > 0 ? { columns: heads, rows: body } : null;
}

export function readFigureAsks(value: unknown): FigureAsk[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { label?: unknown; unit?: unknown };
    if (typeof row.label !== 'string' || row.label.trim() === '') return [];
    return [{ label: row.label, unit: typeof row.unit === 'string' && row.unit !== '' ? row.unit : null }];
  });
}

export function readHandedFigures(value: unknown): HandedFigure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { label?: unknown; value?: unknown };
    if (typeof row.label !== 'string') return [];
    return [{ label: row.label, value: typeof row.value === 'string' ? row.value : '' }];
  });
}

export function toHandInView(row: HandInRow): HandInView {
  return {
    id: row.id,
    answer: row.answer,
    figures: readHandedFigures(row.figures),
    marks: readPointMarks(row.marks).map((mark) => ({ met: mark.met, note: mark.note })),
    passed: row.passed,
  };
}

export function toPracticeView(row: PracticeRow, latest: HandInRow | null, passed: boolean): PracticeView {
  return {
    id: row.id,
    task: row.task,
    data: readTable(row.data),
    figures: readFigureAsks(row.figures),
    spreadsheetNote: row.spreadsheet_note,
    worked: passed ? row.worked : null,
    passed,
    latest: latest ? toHandInView(latest) : null,
  };
}

/**
 * The figures handed in, lined up with the ones the task asks for: each asked
 * label once, in the task's order, with its typed value trimmed and cut to
 * length. Labels the task does not ask for are dropped, so a hand-in cannot
 * smuggle in points of its own.
 */
export function lineUpFigures(asked: readonly FigureAsk[], typed: readonly HandedFigure[]): HandedFigure[] {
  const byLabel = new Map(typed.map((figure) => [figure.label.trim().toLowerCase(), figure.value]));
  return asked.map((figure) => ({
    label: figure.label,
    value: (byLabel.get(figure.label.trim().toLowerCase()) ?? '').trim().slice(0, FIGURE_VALUE_MAX),
  }));
}

/** Whether anything was handed in: working, or at least one figure filled. */
export function handedInSomething(answer: string, figures: readonly HandedFigure[]): boolean {
  return answer.trim() !== '' || figures.some((figure) => figure.value.trim() !== '');
}

/** A piece is passed only when its practice and its check both are. */
export function piecePasses(standing: { practicePassed: boolean; checkPassed: boolean }): boolean {
  return standing.practicePassed && standing.checkPassed;
}
