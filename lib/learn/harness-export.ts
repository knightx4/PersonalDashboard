import type { Sql } from 'postgres';
import type { ExportInput } from '@/lib/learn/ordering-report';

/**
 * The harness export (plan #2154.1): one row per graded answer across probes
 * and cell questions, read for scripts/learn-ordering-report.ts and
 * scripts/learn-measure.ts (plan #2179.2) so both read the same rows.
 *
 * `sql` is the scripts' connection, either postgres or the HTTPS stand-in
 * lib/db/https-sql.ts gives a cloud session.
 */
export type HarnessExport = { rows: ExportInput[]; probes: number; cellQuestions: number };

type Rows = Record<string, unknown>[];

const date = (value: unknown) => (value ? new Date(value as string | Date) : null);
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** A probe's outcome: Don't know, the grader's verdict on a written answer, or the option picked. */
export function probeOutcome(r: Record<string, unknown>): string | null {
  if (r.dont_know) return 'dont_know';
  if (typeof r.response_correct === 'boolean') return r.response_correct ? 'right' : 'wrong';
  if (r.chosen_index === null || r.chosen_index === undefined) return null;
  return r.chosen_index === r.correct_index ? 'right' : 'wrong';
}

/** Whether a cell question's first grader met the cell it asked about; null when it gave no verdict on it. */
export function askedCellMet(grade: unknown, cellId: unknown): boolean | null {
  if (!Array.isArray(grade)) return null;
  const own = grade.find((g) => g && typeof g === 'object' && (g as { cell_id?: unknown }).cell_id === cellId) as
    | { verdict?: unknown }
    | undefined;
  if (!own || own.verdict === 'not_touched' || own.verdict === undefined) return null;
  return own.verdict === 'met';
}

export async function loadHarnessExport(sql: Sql, user: string | null): Promise<HarnessExport> {
  const probeRows = (await sql`
    select id, shown_at, answered_at, answer_seconds, predicted_strength, dont_know,
           response_correct, chosen_index, correct_index, confidence
    from learn.probes
    where answered_at is not null and discarded_at is null
      and (${user}::uuid is null or user_id = ${user}::uuid)
    order by answered_at`) as unknown as Rows;
  const cellRows = (await sql`
    select id, cell_id, shown_at, answered_at, answer_seconds, predicted_status, predicted_level, grade, grade_second,
           confidence
    from learn.cell_questions
    where answered_at is not null and grade is not null
      and (${user}::uuid is null or user_id = ${user}::uuid)
    order by answered_at`) as unknown as Rows;

  const rows: ExportInput[] = [
    ...probeRows.map(
      (r): ExportInput => ({
        source: 'probe',
        id: String(r.id),
        shownAt: date(r.shown_at),
        answeredAt: date(r.answered_at),
        answerSeconds: num(r.answer_seconds),
        predictedStrength: num(r.predicted_strength),
        predictedStatus: null,
        predictedLevel: null,
        outcome: probeOutcome(r),
        grade: typeof r.response_correct === 'boolean' ? r.response_correct : null,
        gradeSecond: null,
        confidence: num(r.confidence),
      }),
    ),
    ...cellRows.map(
      (r): ExportInput => ({
        source: 'cell_question',
        id: String(r.id),
        shownAt: date(r.shown_at),
        answeredAt: date(r.answered_at),
        answerSeconds: num(r.answer_seconds),
        predictedStrength: null,
        predictedStatus: r.predicted_status ? String(r.predicted_status) : null,
        predictedLevel: num(r.predicted_level),
        outcome: null,
        grade: r.grade,
        gradeSecond: r.grade_second,
        confidence: num(r.confidence),
        right: askedCellMet(r.grade, r.cell_id),
      }),
    ),
  ];
  return { rows, probes: probeRows.length, cellQuestions: cellRows.length };
}
