'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { writePieceLesson, type PieceLessonResult } from '@/inngest/learn/piece-lesson';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { toPieceCheck, type PieceCheck, type PieceCheckRow } from '@/lib/learn/lessons/piece-check';
import {
  loadAskedQuestions,
  loadPieceForCheck,
  loadPieceRow,
  markPieceIdeasTested,
  markPiecePassed,
} from '@/lib/learn/lessons/piece-store';
import { markPieceCheck, PIECE_CHECK_MODEL, writePieceCheck } from '@/lib/learn/lessons/write-piece-check';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * The presses on a piece's page (plan #1141, LEARN-LESSONS-SPEC "A piece is
 * worked through on its own page"). Writing an idea's missing lesson, asking
 * the piece's check, and answering it. The question is stored before it is
 * shown, so the answer only names the row it answers and a closed tab loses
 * nothing.
 */

const Id = z.string().uuid();
const AnswerText = z.string().trim().min(1).max(2000);

/** Writing the lesson for an idea of the piece that has none, as the page opens. */
// latency: pending
export async function writeLessonForPiece(
  subjectId: string,
  pieceId: string,
  conceptId: string,
): Promise<PieceLessonResult> {
  const user = await requireUser();
  const ids = z.tuple([Id, Id, Id]).safeParse([subjectId, pieceId, conceptId]);
  if (!ids.success) return { ok: false, detail: 'Could not tell which idea that was.' };

  // The person's own session first, so a piece that is not theirs is refused
  // before the service role is reached.
  const learn = await createLearnClient();
  const piece = await loadPieceRow(learn, user.id, ids.data[0], ids.data[1]).catch(() => null);
  if (!piece || !piece.concept_ids.includes(ids.data[2])) return { ok: false, detail: 'That idea is not in this piece.' };

  return writePieceLesson(user.id, { subjectId: ids.data[0], pieceId: ids.data[1], conceptId: ids.data[2] }).catch(
    (error: unknown) => ({ ok: false as const, detail: error instanceof Error ? error.message : 'Writing the lesson failed.' }),
  );
}

export type AskResult = { error?: string; check?: PieceCheck };

/**
 * Ask me the question, and Try another question after a wrong answer. Haiku
 * writes one question needing the piece's ideas together, told every question
 * already asked on the piece so the next is fresh. An unanswered question
 * already there is shown again rather than paying for another.
 */
// latency: pending
export async function askPieceCheck(subjectId: string, pieceId: string): Promise<AskResult> {
  const user = await requireUser();
  const ids = z.tuple([Id, Id]).safeParse([subjectId, pieceId]);
  if (!ids.success) return { error: 'Could not tell which piece that was.' };
  const [subject, pieceIdValue] = ids.data;
  const learn = await createLearnClient();

  try {
    const { data: open, error: openError } = await learn
      .from('piece_checks')
      .select('id, question, expected, response, correct, marked_why')
      .eq('user_id', user.id)
      .eq('piece_id', pieceIdValue)
      .is('response', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openError) return { error: `Reading the piece's check failed: ${openError.message}` };
    if (open) return { check: toPieceCheck(open as PieceCheckRow) };

    const loaded = await loadPieceForCheck(learn, user.id, subject, pieceIdValue);
    if (!loaded) return { error: 'This piece has no ideas left to ask about.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'Writing a question needs ANTHROPIC_API_KEY to be set.' };

    const asked = await loadAskedQuestions(learn, user.id, pieceIdValue);
    const spend = collectSpend();
    let written = await writePieceCheck({ piece: loaded.piece, asked, anthropicApiKey: apiKey, onSpend: spend.sink });
    // A question that gave its answer away or asked for a term is thrown out;
    // one more try usually lands.
    if (written.outcome === 'dropped') {
      written = await writePieceCheck({ piece: loaded.piece, asked, anthropicApiKey: apiKey, onSpend: spend.sink });
    }
    await recordLearnSpend(user.id, 'write-piece-check', spend.reports);
    if (written.outcome === 'failed') return { error: `Writing the question failed: ${written.detail}` };
    if (written.outcome === 'dropped') return { error: 'Dash could not write a fair question this time. Try again.' };

    const { data: row, error } = await learn
      .from('piece_checks')
      .insert({
        user_id: user.id,
        piece_id: pieceIdValue,
        question: written.question,
        expected: written.expected,
        write_model: PIECE_CHECK_MODEL,
      })
      .select('id, question, expected, response, correct, marked_why')
      .single();
    if (error) return { error: `Saving the question failed: ${error.message}` };
    return { check: toPieceCheck(row as PieceCheckRow) };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not write a question.' };
  }
}

export type AnswerResult = {
  error?: string;
  check?: PieceCheck;
  /** When the piece was passed, on a right answer. */
  passedAt?: string;
  /** Ideas marked tested by a right answer. */
  tested?: number;
};

/**
 * Check my answer. Haiku marks what was written against the answer expected.
 * A right answer passes the piece and marks its ideas tested; a wrong one
 * keeps the mark and the sentence on what was missing, and changes nothing
 * else. Marking the piece yourself is not a thing this page offers.
 */
// latency: pending
export async function answerPieceCheck(
  subjectId: string,
  pieceId: string,
  checkId: string,
  response: string,
): Promise<AnswerResult> {
  const user = await requireUser();
  const ids = z.tuple([Id, Id, Id]).safeParse([subjectId, pieceId, checkId]);
  if (!ids.success) return { error: 'Could not tell which question that was.' };
  const answer = AnswerText.safeParse(response);
  if (!answer.success) return { error: 'Write an answer first, in a sentence or two.' };
  const [subject, pieceIdValue, checkIdValue] = ids.data;
  const learn = await createLearnClient();

  try {
    const { data, error } = await learn
      .from('piece_checks')
      .select('id, question, expected, response, correct, marked_why')
      .eq('id', checkIdValue)
      .eq('piece_id', pieceIdValue)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return { error: `Reading the question failed: ${error.message}` };
    const row = data as PieceCheckRow | null;
    if (!row) return { error: 'That question is no longer there.' };
    // Answered already, in another tab: show that mark rather than paying for another.
    if (row.correct !== null) return { check: toPieceCheck(row) };

    const loaded = await loadPieceForCheck(learn, user.id, subject, pieceIdValue);
    if (!loaded) return { error: 'This piece is no longer there.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'Marking an answer needs ANTHROPIC_API_KEY to be set.' };

    const spend = collectSpend();
    const grade = await markPieceCheck({
      piece: loaded.piece,
      question: row.question,
      expected: row.expected,
      response: answer.data,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'mark-piece-check', spend.reports);
    if (!grade.ok) return { error: `Marking failed: ${grade.detail}` };

    const { data: marked, error: markError } = await learn
      .from('piece_checks')
      .update({
        response: answer.data,
        correct: grade.correct,
        marked_why: grade.why,
        answered_at: new Date().toISOString(),
      })
      .eq('id', checkIdValue)
      .eq('user_id', user.id)
      .is('response', null)
      .select('id, question, expected, response, correct, marked_why');
    if (markError) return { error: `Recording the answer failed: ${markError.message}` };
    // Another press got there first and recorded its own mark.
    const saved = (marked ?? [])[0] as PieceCheckRow | undefined;
    if (!saved) return { error: 'That question has been answered already.' };

    if (!grade.correct) return { check: toPieceCheck(saved) };

    const passedAt = loaded.passedAt ?? (await markPiecePassed(learn, user.id, pieceIdValue));
    const tested = await markPieceIdeasTested(learn, user.id, loaded.conceptIds);
    revalidatePath(`/learn/s/${subject}`);
    return { check: toPieceCheck(saved), passedAt, tested };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not mark that.' };
  }
}
