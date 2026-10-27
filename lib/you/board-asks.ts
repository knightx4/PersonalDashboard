import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * What the board asks the person (you.board_questions.asks, migrations-you/0023,
 * plan #2561.11). When a question lacks a fact that would change the verdict,
 * the chair debates it on stated assumptions and leaves one to three short
 * questions on the question's row. The Board tab shows them under "The board
 * asks you" with an answer box each; the next meeting reads the answers first
 * and marks them read (.claude/skills/board/SKILL.md).
 *
 * A board session writes the asks through scripts/sql.ts, so rows are read
 * defensively: an entry of the wrong shape is dropped and the rest kept.
 */

export const ASK_ANSWER_MAX = 2000;
/** The meetings one ask can be put in: the first time and at most two more. */
export const ASK_TIMES_MAX = 3;

export type BoardAsk = {
  id: string;
  text: string;
  /** The meetings that put it. */
  askedIn: string[];
  answer: string | null;
  answeredAt: string | null;
  /** The meeting that has read the answer. */
  readIn: string | null;
};

/** An ask with the question it is about, for the tab. */
export type PersonAsk = BoardAsk & { questionId: string; question: string };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function asksOf(value: unknown): BoardAsk[] {
  if (!Array.isArray(value)) return [];
  const out: BoardAsk[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = text(row.id);
    const body = text(row.text);
    if (!id || !body || out.some((a) => a.id === id)) continue;
    out.push({
      id,
      text: body,
      askedIn: Array.isArray(row.asked_in) ? row.asked_in.filter((m): m is string => typeof m === 'string') : [],
      answer: text(row.answer) || null,
      answeredAt: typeof row.answered_at === 'string' ? row.answered_at : null,
      readIn: typeof row.read_in === 'string' ? row.read_in : null,
    });
  }
  return out;
}

/** Whether the tab still shows it: unanswered, or answered and not yet read by a meeting. */
export function askShown(ask: BoardAsk): boolean {
  return ask.answer === null || ask.readIn === null;
}

/** The asks as the table holds them. */
export function asksToJson(asks: readonly BoardAsk[]) {
  return asks.map((a) => ({
    id: a.id,
    text: a.text,
    asked_in: a.askedIn,
    answer: a.answer,
    answered_at: a.answeredAt,
    read_in: a.readIn,
  }));
}

/** Why an answer cannot be saved, or null. A blank one takes the answer off. */
export function answerError(answer: string): string | null {
  return answer.trim().length > ASK_ANSWER_MAX
    ? `An answer holds at most ${String(ASK_ANSWER_MAX).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} characters.`
    : null;
}

/** The asks with one answered (or cleared, when blank), or null when none has that id. */
export function withAnswer(
  asks: readonly BoardAsk[],
  askId: string,
  answer: string,
  at: string,
): BoardAsk[] | null {
  if (!asks.some((a) => a.id === askId)) return null;
  const clean = answer.trim();
  return asks.map((a) =>
    a.id === askId
      ? { ...a, answer: clean || null, answeredAt: clean ? at : null, readIn: null }
      : a,
  );
}

/** The asks on their open and decided questions that the tab shows, oldest question first. */
export async function listBoardAsks(client: YouSupabaseClient, userId: string): Promise<PersonAsk[]> {
  const { data, error } = await client
    .from('board_questions')
    .select('id, question, asks, created_at')
    .eq('user_id', userId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string') return [];
    return asksOf(r.asks)
      .filter(askShown)
      .map((ask) => ({ ...ask, questionId: r.id as string, question: text(r.question) }));
  });
}

/**
 * Save the person's answer to one ask. Reads the question's asks and writes
 * them back only if the row has not changed since, so a meeting writing at
 * the same moment is not overwritten. Returns whether it saved.
 */
export async function answerAsk(
  client: YouSupabaseClient,
  userId: string,
  questionId: string,
  askId: string,
  answer: string,
  at: string = new Date().toISOString(),
): Promise<'saved' | 'missing' | 'changed'> {
  const { data, error } = await client
    .from('board_questions')
    .select('asks, updated_at')
    .eq('user_id', userId)
    .eq('id', questionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return 'missing';
  const next = withAnswer(asksOf(data.asks), askId, answer, at);
  if (!next) return 'missing';
  const { data: written, error: writeError } = await client
    .from('board_questions')
    .update({ asks: asksToJson(next) })
    .eq('user_id', userId)
    .eq('id', questionId)
    .eq('updated_at', data.updated_at as string)
    .select('id');
  if (writeError) throw new Error(writeError.message);
  return (written ?? []).length > 0 ? 'saved' : 'changed';
}
