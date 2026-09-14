import type { HitKind } from '@/lib/search/sources';

/**
 * What a quiz is made of, in the app's own words.
 *
 * Types and limits only, with no `server-only` and no client: the picking
 * screen runs in the browser and needs the same caps the server enforces, and
 * the title a quiz gets is worth testing without a database.
 *
 * The three tables behind this are in supabase/migrations-learn/0014_quizzes.sql.
 * A note is named by id and read where it lives; a paste has no other home, so
 * that is the one thing stored.
 */

/** How far through a quiz you are. Derived from the questions by the database. */
export type QuizStatus = 'unanswered' | 'part_done' | 'finished';

/** How one answer came out. */
export type QuizOutcome = 'right' | 'wrong' | 'skipped';

/** One piece of material: a note in the vault, or text that was pasted in. */
export type QuizSource = {
  id: string;
  position: number;
  /** The note it points at, read where it lives. Null on a paste. */
  noteId: string | null;
  /** The pasted text. Null on a note. */
  body: string | null;
};

/** One question, what you wrote, and how it was marked. */
export type QuizQuestion = {
  id: string;
  position: number;
  sourceId: string;
  question: string;
  expected: string;
  response: string | null;
  outcome: QuizOutcome | null;
};

/** A quiz, its material and its questions in the order they are asked. */
export type Quiz = {
  id: string;
  title: string;
  preparingFor: string | null;
  status: QuizStatus;
  createdAt: string;
  sources: QuizSource[];
  questions: QuizQuestion[];
};

/** What the search box answers with when it is being asked for quiz material. */
export const QUIZ_HIT_KINDS: readonly HitKind[] = ['note'];

/** The most notes one quiz is written from. Ten sources is already a lot of text. */
export const MAX_QUIZ_NOTES = 10;

/**
 * The most pasted text a quiz takes.
 *
 * The same order as the briefing box on /learn/know, and for the same reason:
 * past this the questions come from the first few pages and the rest is paid
 * for and ignored.
 */
export const MAX_PASTE_CHARS = 24_000;

/** The most you can write about what you are preparing for. */
export const MAX_PREPARING_FOR_CHARS = 200;

/** One line, trimmed to something that fits a row in a list. */
function firstLine(text: string, limit: number): string {
  const line = text.split(/\r?\n/).find((part) => part.trim().length > 0)?.trim() ?? '';
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/**
 * What to call a quiz in the list of the ones you have taken.
 *
 * Nobody wants to invent a name for something they are about to answer, so it
 * is derived and never asked for. What you are preparing for makes the best
 * one when you wrote it: two quizzes over the same notes are told apart by
 * nothing else. The notes come next, and a date last -- which beats "Untitled"
 * six weeks later.
 */
export function quizTitle(input: {
  preparingFor?: string | null;
  noteNames: readonly string[];
  today: string;
}): string {
  const preparing = firstLine(input.preparingFor ?? '', 80);
  if (preparing.length >= 3) return preparing;

  const names = input.noteNames.map((name) => name.trim()).filter((name) => name.length > 0);
  if (names.length === 1) return firstLine(names[0]!, 80);
  if (names.length === 2) return firstLine(`${names[0]} and ${names[1]}`, 80);
  if (names.length > 2) {
    return firstLine(`${names[0]} and ${names.length - 1} more`, 80);
  }

  return `Quiz, ${input.today}`;
}
