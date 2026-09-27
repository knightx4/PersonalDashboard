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
  loadLessons,
  loadPieceRow,
  markPieceIdeasTested,
} from '@/lib/learn/lessons/piece-store';
import { lineUpFigures, handedInSomething, ANSWER_MAX, type PracticeView } from '@/lib/learn/lessons/practice';
import {
  loadPracticeRow,
  passPieceIfDone,
  practiceViewOf,
} from '@/lib/learn/lessons/practice-store';
import { MARK_POINTS_MODEL } from '@/lib/learn/lessons/mark-points';
import { markPractice, WRITE_PRACTICE_MODEL, writePractice } from '@/lib/learn/lessons/write-practice';
import { markPieceCheck, PIECE_CHECK_MODEL, writePieceCheck } from '@/lib/learn/lessons/write-piece-check';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * The presses on a piece's page (plan #1141, LEARN-LESSONS-SPEC "A piece is
 * worked through on its own page"). Writing an idea's missing lesson, writing
 * the piece's practice task and marking what is handed in for it (plan
 * #1142), asking the piece's check, and answering it. The question is stored before it is
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
  /** Whether the practice is passed too, on a right answer. */
  practicePassed?: boolean;
};

/**
 * Check my answer. Haiku marks what was written against the answer expected.
 * A right answer marks the piece's ideas tested, and passes the piece when
 * its practice is passed too; a wrong one keeps the mark and the sentence on
 * what was missing, and changes nothing else. Marking the piece yourself is
 * not a thing this page offers.
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

    // A right answer shows the ideas are known, whatever the practice says;
    // the piece itself passes only once its practice has too.
    const tested = await markPieceIdeasTested(learn, user.id, loaded.conceptIds);
    const standing = await passPieceIfDone(learn, user.id, pieceIdValue, loaded.passedAt);
    revalidatePath(`/learn/s/${subject}`);
    return {
      check: toPieceCheck(saved),
      passedAt: standing.passedAt ?? undefined,
      practicePassed: standing.practicePassed,
      tested,
    };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not mark that.' };
  }
}

export type PracticeResult = { error?: string; practice?: PracticeView };

/**
 * Writing the piece's practice task, as the page opens when the piece has
 * none, and on Write the task after that fails. Sonnet writes it from the
 * piece's ideas and whichever of its lessons are written. A task already
 * there, from another tab, is shown rather than paid for again.
 */
// latency: pending
export async function writePiecePractice(subjectId: string, pieceId: string): Promise<PracticeResult> {
  const user = await requireUser();
  const ids = z.tuple([Id, Id]).safeParse([subjectId, pieceId]);
  if (!ids.success) return { error: 'Could not tell which piece that was.' };
  const [subject, pieceIdValue] = ids.data;
  const learn = await createLearnClient();

  try {
    const existing = await loadPracticeRow(learn, user.id, pieceIdValue);
    if (existing) return { practice: await practiceViewOf(learn, user.id, existing) };

    const loaded = await loadPieceForCheck(learn, user.id, subject, pieceIdValue);
    if (!loaded) return { error: 'This piece has no ideas left to practise.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'Writing the practice task needs ANTHROPIC_API_KEY to be set.' };

    const lessons = await loadLessons(learn, user.id, loaded.conceptIds);
    const forWriter = loaded.conceptIds.map((conceptId, index) => {
      const lesson = lessons.get(conceptId)?.lesson ?? null;
      return {
        name: loaded.piece.ideas[index]?.name ?? '',
        takeaway: lesson?.takeaway ?? null,
        example: lesson?.example ?? null,
      };
    });

    const spend = collectSpend();
    let written = await writePractice({ piece: loaded.piece, lessons: forWriter, anthropicApiKey: apiKey, onSpend: spend.sink });
    // A task that came back without its points or worked answer is thrown
    // out; one more try usually lands.
    if (written.outcome === 'dropped') {
      written = await writePractice({ piece: loaded.piece, lessons: forWriter, anthropicApiKey: apiKey, onSpend: spend.sink });
    }
    await recordLearnSpend(user.id, 'write-piece-practice', spend.reports);
    if (written.outcome === 'failed') return { error: `Writing the task failed: ${written.detail}` };
    if (written.outcome === 'dropped') return { error: 'Dash could not write a usable task this time. Try again.' };

    const { practice } = written;
    const { error } = await learn.from('piece_practice').insert({
      user_id: user.id,
      piece_id: pieceIdValue,
      task: practice.task,
      data: practice.data,
      figures: practice.figures,
      points: practice.points,
      worked: practice.worked,
      spreadsheet_note: practice.spreadsheetNote,
      write_model: WRITE_PRACTICE_MODEL,
    });
    // 23505: another tab wrote the piece's task first; show that one.
    if (error && error.code !== '23505') return { error: `Saving the task failed: ${error.message}` };

    const saved = await loadPracticeRow(learn, user.id, pieceIdValue);
    if (!saved) return { error: 'The task was not saved.' };
    return { practice: await practiceViewOf(learn, user.id, saved) };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not write the task.' };
  }
}

export type HandInResult = {
  error?: string;
  practice?: PracticeView;
  /** When the piece was passed, once the practice and the check both are. */
  passedAt?: string;
  /** Whether the check is passed too, on a passing hand-in. */
  checkPassed?: boolean;
};

const HandInFigures = z
  .array(z.object({ label: z.string().max(200), value: z.string().max(1000) }))
  .max(20);

/**
 * Hand it in. Haiku marks what was typed against each point the task listed,
 * saying what was right and what was missing. Every point met passes the
 * practice, and the piece with it when its check is passed too. A hand-in
 * that misses a point changes nothing else, and can be handed in again.
 */
// latency: pending
export async function handInPractice(
  subjectId: string,
  pieceId: string,
  practiceId: string,
  answer: string,
  figures: { label: string; value: string }[],
): Promise<HandInResult> {
  const user = await requireUser();
  const ids = z.tuple([Id, Id, Id]).safeParse([subjectId, pieceId, practiceId]);
  if (!ids.success) return { error: 'Could not tell which task that was.' };
  const typed = HandInFigures.safeParse(figures);
  if (!typed.success) return { error: 'Could not read the figures handed in.' };
  const [subject, pieceIdValue, practiceIdValue] = ids.data;
  const working = String(answer ?? '').trim().slice(0, ANSWER_MAX);
  const learn = await createLearnClient();

  try {
    const row = await loadPracticeRow(learn, user.id, pieceIdValue);
    if (!row || row.id !== practiceIdValue) return { error: 'That task is no longer there.' };
    const current = await practiceViewOf(learn, user.id, row);
    // Passed already, in another tab: show that rather than paying to mark it again.
    if (current.passed) return { practice: current };

    const lined = lineUpFigures(current.figures, typed.data);
    if (!handedInSomething(working, lined)) return { error: 'Type in the figures or your working first.' };

    const loaded = await loadPieceForCheck(learn, user.id, subject, pieceIdValue);
    if (!loaded) return { error: 'This piece is no longer there.' };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: 'Marking a hand-in needs ANTHROPIC_API_KEY to be set.' };

    const spend = collectSpend();
    const marked = await markPractice({
      piece: loaded.piece,
      task: row.task,
      points: row.points,
      worked: row.worked,
      handIn: { answer: working, figures: lined },
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'mark-piece-practice', spend.reports);
    if (!marked.ok) return { error: `Marking failed: ${marked.detail}` };

    const { error } = await learn.from('piece_practice_handins').insert({
      user_id: user.id,
      practice_id: row.id,
      answer: working,
      figures: lined,
      marks: marked.marks,
      passed: marked.passed,
      mark_model: MARK_POINTS_MODEL,
    });
    if (error) return { error: `Recording the hand-in failed: ${error.message}` };

    const practice = await practiceViewOf(learn, user.id, row);
    if (!marked.passed) return { practice };

    const standing = await passPieceIfDone(learn, user.id, pieceIdValue, loaded.passedAt);
    revalidatePath(`/learn/s/${subject}`);
    return { practice, passedAt: standing.passedAt ?? undefined, checkPassed: standing.checkPassed };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not mark that.' };
  }
}
