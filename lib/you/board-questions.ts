import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The questions put to the board and the roster that can answer them
 * (you.board_questions and you.board_advisors, migrations-you/0022, plan
 * #2561.1), read and written for the Board tab's Ask the board (plan
 * #2561.4).
 *
 * A board session writes suggested questions through scripts/sql.ts
 * (.claude/skills/board/SKILL.md), so rows are read defensively: an option of
 * the wrong shape is dropped and the rest kept. Every call names the person as
 * well as relying on row level security, so the same functions serve a
 * service-role client.
 */

export const QUESTION_MAX = 1000;
export const OPTION_MAX = 300;
export const CONTEXT_MAX = 4000;
export const LEAN_MAX = 500;
/** Two to four options, or none for the chair to write. */
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 4;
export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export const QUESTION_STATUSES = [
  'suggested',
  'queued',
  'discussing',
  'decided',
  'dismissed',
  'deferred',
] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_SOURCES = ['person', 'suggested', 'board'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export type BoardOption = { letter: string; text: string };

export type BoardQuestion = {
  id: string;
  question: string;
  options: BoardOption[];
  context: string | null;
  lean: string | null;
  advisors: string[];
  source: QuestionSource;
  status: QuestionStatus;
  meetingId: string | null;
  createdAt: string;
};

export type BoardAdvisor = {
  key: string;
  name: string;
  kind: 'seat' | 'guest';
  focus: string | null;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const oneOf = <T extends string>(words: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (words as readonly string[]).includes(value) ? (value as T) : null;

/** The options as the table holds them, wrong shapes dropped. */
export function optionsOf(value: unknown): BoardOption[] {
  if (!Array.isArray(value)) return [];
  const out: BoardOption[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const letter = text(row.letter).toUpperCase();
    const body = text(row.text);
    if (!/^[A-Z]$/.test(letter) || !body) continue;
    out.push({ letter, text: body });
  }
  return out;
}

export function questionOf(row: Record<string, unknown>): BoardQuestion | null {
  const status = oneOf(QUESTION_STATUSES, row.status);
  const question = text(row.question);
  if (!status || !question || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    question,
    options: optionsOf(row.options),
    context: text(row.context) || null,
    lean: text(row.lean) || null,
    advisors: Array.isArray(row.advisors) ? row.advisors.filter((a): a is string => typeof a === 'string') : [],
    source: oneOf(QUESTION_SOURCES, row.source) ?? 'person',
    status,
    meetingId: typeof row.meeting_id === 'string' ? row.meeting_id : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

const QUESTION_COLUMNS =
  'id, question, options, context, lean, advisors, source, status, meeting_id, created_at';

/** What the tab lists: the suggestions waiting on them, and the asked questions not yet settled. */
export const OPEN_STATUSES: readonly QuestionStatus[] = ['suggested', 'queued', 'discussing', 'deferred'];

/** Their suggested and open questions, newest first. */
export async function listBoardQuestions(
  client: YouSupabaseClient,
  userId: string,
): Promise<BoardQuestion[]> {
  const { data, error } = await client
    .from('board_questions')
    .select(QUESTION_COLUMNS)
    .eq('user_id', userId)
    .in('status', OPEN_STATUSES as QuestionStatus[])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => questionOf(row as Record<string, unknown>))
    .filter((q): q is BoardQuestion => q !== null);
}

export async function loadBoardQuestion(
  client: YouSupabaseClient,
  userId: string,
  id: string,
): Promise<BoardQuestion | null> {
  const { data, error } = await client
    .from('board_questions')
    .select(QUESTION_COLUMNS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? questionOf(data as Record<string, unknown>) : null;
}

/** The roster that can sit: the five seats first, then the guests with a ready brain, each in name order. */
export async function listBoardAdvisors(
  client: YouSupabaseClient,
  userId: string,
): Promise<BoardAdvisor[]> {
  const { data, error } = await client
    .from('board_advisors')
    .select('key, name, kind, focus, brain_status')
    .eq('user_id', userId)
    .eq('active', true);
  if (error) throw new Error(error.message);
  return sortAdvisors(
    (data ?? []).flatMap((row) => {
      const r = row as Record<string, unknown>;
      const key = text(r.key);
      const name = text(r.name);
      if (!key || !name) return [];
      // A guest sits only on a ready brain (.claude/skills/board/SKILL.md), so one still being built is not offered.
      if (r.kind !== 'seat' && r.brain_status !== 'ready') return [];
      return [{ key, name, kind: r.kind === 'seat' ? 'seat' : 'guest', focus: text(r.focus) || null } as BoardAdvisor];
    }),
  );
}

const SEAT_ORDER = ['hiring_manager', 'mentor', 'skeptic', 'cfo', 'dreamer'];

export function sortAdvisors<T extends BoardAdvisor>(advisors: readonly T[]): T[] {
  const rank = (a: T) => (a.kind === 'seat' ? SEAT_ORDER.indexOf(a.key) : 99);
  return [...advisors].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * A guest's initials, which is how the tab shows a guest: the guests are
 * personas built from public work, not the people, so no face and no
 * signature. "Leonardo da Vinci" is LV, "Warren Buffett" WB.
 */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w));
  const picked = words.length >= 2 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return picked.map((w) => w[0]).join('') || name.slice(0, 1).toUpperCase();
}

export type QuestionInput = {
  question: string;
  options: readonly string[];
  context: string;
  lean: string;
  advisors: readonly string[];
  /** Seats to leave out of this one question; the other seats sit as always (plan #2561.12). */
  seatsOff?: readonly string[];
};

export type CleanQuestion = {
  question: string;
  options: BoardOption[];
  context: string | null;
  lean: string | null;
  advisors: string[];
  seats_off: string[];
};

/** 1000 as "1,000". */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * The question as the table takes it, or why it cannot be asked. Blank
 * option lines are dropped; what is left must be none (the chair writes
 * them) or two to four, lettered A to D in the order given. A lean that
 * names an option by letter is kept as the letter.
 */
export function cleanQuestion(
  input: QuestionInput,
  roster: readonly string[],
): { ok: true; value: CleanQuestion } | { ok: false; error: string } {
  const question = oneLine(input.question);
  if (!question) return { ok: false, error: 'Write the question first.' };
  if (question.length > QUESTION_MAX)
    return { ok: false, error: `Keep the question to at most ${thousands(QUESTION_MAX)} characters.` };

  const lines = input.options.map(oneLine).filter(Boolean);
  if (lines.length === 1)
    return { ok: false, error: 'Give at least two options, or leave them all blank for the board to write.' };
  if (lines.length > OPTIONS_MAX) return { ok: false, error: `Give at most ${OPTIONS_MAX} options.` };
  if (lines.some((line) => line.length > OPTION_MAX))
    return { ok: false, error: `Keep each option to at most ${OPTION_MAX} characters.` };
  const options = lines.map((line, i) => ({ letter: OPTION_LETTERS[i], text: line }));

  const context = input.context.trim();
  if (context.length > CONTEXT_MAX)
    return { ok: false, error: `Keep the context to at most ${thousands(CONTEXT_MAX)} characters.` };

  const lean = oneLine(input.lean);
  if (lean.length > LEAN_MAX) return { ok: false, error: `Keep the lean to at most ${LEAN_MAX} characters.` };
  if (/^[A-Z]$/i.test(lean) && !options.some((o) => o.letter === lean.toUpperCase()))
    return { ok: false, error: `There is no option ${lean.toUpperCase()} to lean towards.` };

  const known = new Set(roster);
  const advisors = [...new Set(input.advisors)];
  if (advisors.some((key) => !known.has(key)))
    return { ok: false, error: 'One of the advisors you picked is not on your board.' };

  const seatsOff = [...new Set(input.seatsOff ?? [])];
  if (seatsOff.some((key) => !SEAT_ORDER.includes(key)))
    return { ok: false, error: 'Only one of the five seats can be turned off.' };

  return {
    ok: true,
    value: {
      question,
      options,
      context: context || null,
      lean: /^[A-Z]$/i.test(lean) ? lean.toUpperCase() : lean || null,
      advisors,
      seats_off: seatsOff,
    },
  };
}

/** Insert one asked question, queued for the next meeting. */
export async function insertBoardQuestion(
  client: YouSupabaseClient,
  userId: string,
  value: CleanQuestion,
): Promise<BoardQuestion> {
  const { data, error } = await client
    .from('board_questions')
    .insert({ user_id: userId, ...value, source: 'person', status: 'queued' })
    .select(QUESTION_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'The question was not saved.');
  const row = questionOf(data as Record<string, unknown>);
  if (!row) throw new Error('The question was not saved.');
  return row;
}

/**
 * Move a question from one status to another, only if it is still in the
 * one expected, so a press on a stale page cannot undo a meeting's work.
 * Returns whether it moved.
 */
export async function moveBoardQuestion(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  from: readonly QuestionStatus[],
  to: { status: QuestionStatus; meeting_id?: string | null },
): Promise<boolean> {
  const { data, error } = await client
    .from('board_questions')
    .update(to)
    .eq('user_id', userId)
    .eq('id', id)
    .in('status', from as QuestionStatus[])
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** How a question's row names its state on the tab. */
export function questionStateLabel(question: Pick<BoardQuestion, 'status' | 'source'>): string {
  switch (question.status) {
    case 'queued':
      return 'For Sunday';
    case 'discussing':
      return 'In a meeting';
    case 'deferred':
      return 'Put off';
    case 'decided':
      return 'Decided';
    case 'dismissed':
      return 'Dismissed';
    case 'suggested':
      return 'Suggested';
  }
}

// ---------------------------------------------------------------------------
// The person's decision (plan #2561.6).
// ---------------------------------------------------------------------------

export const DECISION_NOTE_MAX = 2000;

/** What the person does with a debated question: pick an option, put it off, or turn it down. */
export type DecisionChoice =
  | { kind: 'option'; letter: string }
  | { kind: 'defer' }
  | { kind: 'reject' };

/** The columns a choice writes. Deciding sets the time; the other choices clear what an earlier decision left. */
export function decisionColumns(
  choice: DecisionChoice,
  note: string | null,
  at: string,
): {
  status: QuestionStatus;
  decided_option: string | null;
  decision_note: string | null;
  decided_at: string | null;
} {
  const decision_note = note?.trim() || null;
  if (choice.kind === 'option')
    return { status: 'decided', decided_option: choice.letter, decision_note, decided_at: at };
  return {
    status: choice.kind === 'defer' ? 'deferred' : 'dismissed',
    decided_option: null,
    decision_note,
    decided_at: null,
  };
}

/** Why a choice cannot be made on this question, or null. */
export function decisionError(
  choice: DecisionChoice,
  options: readonly BoardOption[],
  note: string | null,
): string | null {
  if (note && note.length > DECISION_NOTE_MAX)
    return `A note holds at most ${thousands(DECISION_NOTE_MAX)} characters.`;
  if (choice.kind === 'option' && !options.some((o) => o.letter === choice.letter))
    return 'That is not one of the question’s options.';
  return null;
}

/** The statuses a debated question can be decided from: waiting on them, put off, or already decided (to change their mind). */
export const DECIDABLE: readonly QuestionStatus[] = ['discussing', 'deferred', 'decided'];

/** Save the person's decision. Returns whether the question was still there to decide. */
export async function decideBoardQuestion(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  choice: DecisionChoice,
  note: string | null,
  at: string = new Date().toISOString(),
): Promise<boolean> {
  const { data, error } = await client
    .from('board_questions')
    .update(decisionColumns(choice, note, at))
    .eq('user_id', userId)
    .eq('id', id)
    .in('status', DECIDABLE as QuestionStatus[])
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export type BoardDecision = {
  id: string;
  question: string;
  options: BoardOption[];
  /** The option the board recommended, from its verdict. */
  recommended: string | null;
  chosen: string;
  note: string | null;
  decidedAt: string;
  meetingId: string | null;
};

export function decisionOf(row: Record<string, unknown>): BoardDecision | null {
  const question = text(row.question);
  const chosen = text(row.decided_option);
  const verdict =
    row.verdict && typeof row.verdict === 'object' ? (row.verdict as Record<string, unknown>) : null;
  const recommended = text(verdict?.recommended);
  if (typeof row.id !== 'string' || !question || !chosen || typeof row.decided_at !== 'string')
    return null;
  return {
    id: row.id,
    question,
    options: optionsOf(row.options),
    recommended: /^[A-Z]$/.test(recommended) ? recommended : null,
    chosen,
    note: text(row.decision_note) || null,
    decidedAt: row.decided_at,
    meetingId: typeof row.meeting_id === 'string' ? row.meeting_id : null,
  };
}

/** Every question they decided, newest decision first. */
export async function listDecisions(
  client: YouSupabaseClient,
  userId: string,
): Promise<BoardDecision[]> {
  const { data, error } = await client
    .from('board_questions')
    .select('id, question, options, verdict, decided_option, decision_note, decided_at, meeting_id')
    .eq('user_id', userId)
    .eq('status', 'decided')
    .order('decided_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => decisionOf(row as Record<string, unknown>))
    .filter((d): d is BoardDecision => d !== null);
}

/** "B, Keep the search full time", or just the letter when the options are gone. */
export function optionLabel(options: readonly BoardOption[], letter: string | null): string | null {
  if (!letter) return null;
  const option = options.find((o) => o.letter === letter);
  return option ? `${letter}, ${option.text}` : letter;
}
