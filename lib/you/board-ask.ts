import { boardRoutine } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { callBoardMeeting } from '@/lib/you/board-start';
import {
  cleanQuestion,
  insertBoardQuestion,
  listBoardAdvisors,
  type BoardQuestion,
  type QuestionInput,
} from '@/lib/you/board-questions';

/**
 * Put a question to the board (plan #2561.4, and from Ask Dash #2561.10): the
 * one function the Board tab's Ask the board button and Dash's ask_board both
 * call, so the two refuse the same things in the same words. The question is
 * saved queued for the Sunday meeting; with `now` a meeting about it is
 * convened at once.
 *
 * `client` is the person's own session or the service role; every query names
 * the user.
 */

export const QUEUED_WHILE_RUNNING =
  'A board meeting is already running, so your question is saved for Sunday. Press Ask now on it once that meeting ends.';

/**
 * Fire a called meeting about one question. The question stays queued with no
 * meeting: the meeting itself moves it to discussing and names itself on it
 * (.claude/skills/board/SKILL.md). One meeting is open at a time; a second is
 * told so and the question waits for Sunday.
 */
export async function conveneBoardQuestion(
  client: YouSupabaseClient,
  userId: string,
  question: Pick<BoardQuestion, 'id' | 'question'>,
): Promise<{ error: string | null }> {
  const result = await callBoardMeeting({
    client,
    userId,
    decision: question.question,
    questionIds: [question.id],
    routine: boardRoutine(),
  });
  if (result.started) return { error: null };
  if (result.reason === 'running') return { error: QUEUED_WHILE_RUNNING };
  return { error: `Your question is saved for Sunday, but the meeting did not start: ${result.error}` };
}

export type PutQuestionResult =
  | { ok: false; error: string }
  | {
      ok: true;
      question: BoardQuestion;
      /** Why a meeting asked for did not start, with the question left queued; null when none was asked for or it started. */
      convening: string | null;
      /** A meeting was asked for and started. */
      convened: boolean;
    };

/** Check, save and optionally convene. A thrown database error is left to the caller. */
export async function putQuestionToBoard(input: {
  client: YouSupabaseClient;
  userId: string;
  question: QuestionInput;
  when: 'now' | 'sunday';
}): Promise<PutQuestionResult> {
  const { client, userId, when } = input;
  const roster = await listBoardAdvisors(client, userId);
  const clean = cleanQuestion(
    input.question,
    roster.map((a) => a.key),
  );
  if (!clean.ok) return { ok: false, error: clean.error };
  const question = await insertBoardQuestion(client, userId, clean.value);
  const result = when === 'now' ? await conveneBoardQuestion(client, userId, question) : { error: null };
  return { ok: true, question, convening: result.error, convened: when === 'now' && !result.error };
}
