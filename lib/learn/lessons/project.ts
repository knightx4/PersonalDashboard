import { z } from 'zod';
import {
  practicePayloadSchema,
  readFigureAsks,
  readTable,
  toHandInView,
  toWrittenPractice,
  type FigureAsk,
  type HandInRow,
  type HandInView,
  type PracticeTable,
  type WrittenLimits,
  type WrittenPractice,
} from './practice';

/**
 * The final project that ends a learning goal's plan (plan #1146,
 * LEARN-LESSONS-SPEC "A plan ends with a final project"). Pure, so the prompt
 * and the rules are tested without a model or a database.
 *
 * One larger task that uses the whole course, written from the plan's
 * outline, handed in by typing into the plan page the way a piece's practice
 * is (named key figures and written working), and marked point by point. It
 * can be attempted at any time. The plan is finished when the project is
 * passed and every piece of every unit is passed.
 */

/** The project is bigger than a piece's practice, so it may ask for more. */
export const PROJECT_LIMITS: WrittenLimits = { points: 8, figures: 8, columns: 8, rows: 16 };

/** Longest written working a hand-in keeps: more than a piece's practice. */
export const PROJECT_ANSWER_MAX = 8000;

/** One unit of the plan, as the brief's writer is given it. */
export type UnitForProject = { ordinal: number; title: string; covers: string | null; outcome: string | null };

/** The plan the brief is written for. */
export type PlanForProject = {
  goal: string;
  about: string | null;
  depth: string | null;
  units: readonly UnitForProject[];
};

/** The lines that say which plan this is, for the writer and the marker. */
export function planLines(plan: PlanForProject, withUnits: 'full' | 'titles'): string[] {
  const units = [...plan.units].sort((a, b) => a.ordinal - b.ordinal);
  return [
    `The learning goal: ${plan.goal.trim()}`,
    ...(plan.about?.trim() ? [`What they want from it: ${plan.about.trim()}`] : []),
    ...(plan.depth ? [`How deep they want to go: ${plan.depth}`] : []),
    '',
    'The units of the course, in order:',
    ...units.flatMap((unit) => [
      `${unit.ordinal}. ${unit.title.trim()}`,
      ...(withUnits === 'full' && unit.covers?.trim() ? [`   Covers: ${unit.covers.trim()}`] : []),
      ...(withUnits === 'full' && unit.outcome?.trim() ? [`   By the end: ${unit.outcome.trim()}`] : []),
    ]),
  ];
}

/** The writer's message: the plan and the tool to call. */
export function projectPrompt(plan: PlanForProject, tool: string): string {
  return [...planLines(plan, 'full'), '', `Call ${tool}.`].join('\n');
}

/** What the writer reports through its tool: a practice task with a title. */
export const projectPayloadSchema = practicePayloadSchema.extend({ title: z.string() });

export type ProjectPayload = z.infer<typeof projectPayloadSchema>;

/** A brief ready to store. */
export type WrittenProject = WrittenPractice & { title: string };

/**
 * The writer's report checked and tidied, as a practice task is, with the
 * project's larger limits. A brief with no title is refused too.
 */
export function toWrittenProject(payload: ProjectPayload): { ok: true; project: WrittenProject } | { ok: false; reason: string } {
  const title = payload.title.trim();
  if (title === '') return { ok: false, reason: 'The project came back without a title.' };
  const checked = toWrittenPractice(payload, PROJECT_LIMITS);
  if (!checked.ok) return checked;
  return { ok: true, project: { ...checked.practice, title: title.slice(0, 120) } };
}

/** The row as stored in learn.plan_projects. */
export type ProjectRow = {
  id: string;
  title: string;
  task: string;
  data: unknown;
  figures: unknown;
  points: string[];
  worked: string;
  spreadsheet_note: string | null;
};

export const PROJECT_COLUMNS = 'id, title, task, data, figures, points, worked, spreadsheet_note';

/**
 * The project as the plan page is given it. The points and the worked answer
 * name the expected figures, so they stay on the server until it is passed.
 */
export type ProjectView = {
  id: string;
  title: string;
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

export function toProjectView(row: ProjectRow, latest: HandInRow | null, passed: boolean): ProjectView {
  return {
    id: row.id,
    title: row.title,
    task: row.task,
    data: readTable(row.data),
    figures: readFigureAsks(row.figures),
    spreadsheetNote: row.spreadsheet_note,
    worked: passed ? row.worked : null,
    passed,
    latest: latest ? toHandInView(latest) : null,
  };
}
