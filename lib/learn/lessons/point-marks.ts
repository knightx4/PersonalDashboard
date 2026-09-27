import { z } from 'zod';

/**
 * Marking a piece of work point by point (plan #1142). Pure, so the prompt and
 * the pass rule are tested without a model.
 *
 * The task that asks for the work also lists the points a complete answer
 * has: a figure with its value, a step, a reason. The marker says of each
 * point whether what was handed in meets it, with one sentence to the person,
 * and the work passes only when every point is met. A piece's practice uses
 * it first; the plan's final project is marked the same way.
 */

/** Points a task may list, at most. The stored column allows a few more. */
export const MAX_POINTS = 6;

/** A figure asked for by name, and the value typed for it. */
export type HandedFigure = { label: string; value: string };

/** What was handed in: written working, and the figures typed by label. */
export type HandIn = { answer: string; figures: readonly HandedFigure[] };

/** One point as marked. `point` is what the task listed; `note` is to the person. */
export type PointMark = { point: string; met: boolean; note: string };

/** The hand-in as the marker reads it. Figures left blank are said to be blank. */
export function handInLines(handIn: HandIn): string[] {
  const lines: string[] = [];
  if (handIn.figures.length > 0) {
    lines.push('Figures handed in:');
    for (const figure of handIn.figures) {
      const value = figure.value.trim();
      lines.push(`- ${figure.label.trim()}: ${value === '' ? '(left blank)' : value}`);
    }
  }
  const answer = handIn.answer.trim();
  if (answer !== '') {
    if (lines.length > 0) lines.push('');
    lines.push('Working handed in:', answer);
  }
  if (lines.length === 0) lines.push('Nothing was handed in.');
  return lines;
}

/** The marker's message: what the work was about, the task, its points, the reference and the hand-in. */
export function markPointsPrompt(input: {
  context: readonly string[];
  task: string;
  points: readonly string[];
  reference: string;
  handIn: HandIn;
  tool: string;
}): string {
  return [
    ...input.context,
    ...(input.context.length > 0 ? [''] : []),
    'The task:',
    input.task.trim(),
    '',
    'The points a complete hand-in has, by number:',
    ...input.points.map((point, index) => `${index + 1}. ${point.trim()}`),
    '',
    'A worked answer, for reference. They have not seen it:',
    input.reference.trim(),
    '',
    ...handInLines(input.handIn),
    '',
    `Call ${input.tool} with a mark for every point, by its number.`,
  ].join('\n');
}

/** What the marker reports through its tool. */
export const pointMarksSchema = z.object({
  marks: z.array(
    z.object({
      number: z.number().int(),
      met: z.boolean(),
      note: z.string(),
    }),
  ),
});

export type ReportedMarks = z.infer<typeof pointMarksSchema>;

/**
 * The marks lined up with the task's points, and whether the work passed.
 * A point reported twice keeps its first mark; a point not reported at all
 * makes the report unusable rather than counting as missed, since a mark the
 * marker never gave would fail the work for nothing it saw.
 */
export function toPointMarks(
  points: readonly string[],
  reported: ReportedMarks,
): { ok: true; marks: PointMark[]; passed: boolean } | { ok: false; reason: string } {
  const byNumber = new Map<number, { met: boolean; note: string }>();
  for (const mark of reported.marks) {
    if (!byNumber.has(mark.number)) byNumber.set(mark.number, { met: mark.met, note: mark.note.trim() });
  }
  const marks: PointMark[] = [];
  for (const [index, point] of points.entries()) {
    const mark = byNumber.get(index + 1);
    if (!mark) return { ok: false, reason: `The marker left point ${index + 1} unmarked.` };
    marks.push({ point, met: mark.met, note: mark.note || (mark.met ? 'Met.' : 'Not met.') });
  }
  if (marks.length === 0) return { ok: false, reason: 'There were no points to mark against.' };
  return { ok: true, marks, passed: marks.every((mark) => mark.met) };
}

/** A stored marks column read back, dropping anything malformed. */
export function readPointMarks(value: unknown): PointMark[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.met !== 'boolean') return [];
    return [
      {
        point: typeof row.point === 'string' ? row.point : '',
        met: row.met,
        note: typeof row.note === 'string' ? row.note : '',
      },
    ];
  });
}
