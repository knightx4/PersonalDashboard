import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  applyGradeRules,
  explainQuestion,
  graderCells,
  linkReviewsFor,
  whatMoved,
  type GradeEvidence,
  type RawVerdict,
  type Moved,
} from '@/lib/learn/levels/grade';
import { writeLevelCase } from '@/lib/learn/levels/case-call';
import { gradeCellAnswer, LEVEL_GRADE_MODEL, LEVEL_GRADE_SECOND_MODEL } from '@/lib/learn/levels/grade-call';
import { loadGradeMap, territoryOf } from '@/lib/learn/levels/loader-grade';
import { questionFormat, readCells } from '@/lib/learn/levels/model';
import { predictedCell } from '@/lib/learn/predicted';

/**
 * Asking an explain question about a cell and recording the answer
 * (docs/LEARN-LEVELS-SPEC.md, "How answers are graded"; plan #2138.5).
 *
 * The answer is graded, the three rules applied (grade.ts), and only then is
 * anything written: the answer on its learn.cell_questions row, one
 * cell_evidence row per verdict that survived, and a link_reviews row for
 * each link a re-shown cell in doubt now argues against. This file is the
 * only writer of cell_evidence from an answer, so rules R1 to R3 hold here or
 * nowhere.
 */

/** A question on screen: what the answer screen needs to draw it. */
export type AskedCell = {
  questionId: string;
  cellId: string;
  topicName: string;
  level: number;
  question: string;
  /** What the question is: an explanation, or a case to work (levels 4 to 6). */
  format: 'explain' | 'case';
};

export type AskCellResult = { ok: true; asked: AskedCell } | { ok: false; error: string };

/**
 * The explain question for a cell, reusing one asked and not yet answered so
 * leaving and coming back does not pile up rows. Refuses a cell on a draft
 * topic and a cell whose level is not explained.
 */
export async function askCell(
  learn: LearnSupabaseClient,
  userId: string,
  cellId: string,
  writer?: { anthropicApiKey: string; onSpend?: SpendSink },
  /** The piece of a plan whose check this question is (plan #2138.13). */
  pieceId?: string,
): Promise<AskCellResult> {
  const { data: cell, error } = await learn
    .from('topic_cells')
    .select('id, level, descriptor, topic:topics!inner(name, status)')
    .or(territoryOf(userId))
    .eq('id', cellId)
    .maybeSingle();
  if (error) return { ok: false, error: `Reading that level failed: ${error.message}` };
  const row = cell as {
    id: string;
    level: number;
    descriptor: string[] | null;
    topic: { name: string; status: string };
  } | null;
  if (!row) return { ok: false, error: 'That level is not one of yours.' };
  if (row.topic.status !== 'approved') return { ok: false, error: 'Approve the topic before it is asked about.' };
  const format = questionFormat(row.level);
  if (format === 'defend') return { ok: false, error: `Level ${row.level} is asked as a defence, which is not built yet.` };

  const openQuery = learn
    .from('cell_questions')
    .select('id, question')
    .eq('user_id', userId)
    .eq('cell_id', cellId)
    .eq('format', format)
    .is('answered_at', null);
  const { data: open } = await (pieceId ? openQuery.eq('piece_id', pieceId) : openQuery.is('piece_id', null))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const reuse = open as { id: string; question: string } | null;
  const asked = (questionId: string, question: string): AskCellResult => ({
    ok: true,
    asked: { questionId, cellId, topicName: row.topic.name, level: row.level, question, format },
  });
  if (reuse) return asked(reuse.id, reuse.question);

  let text: string;
  let expected: string | null = null;
  if (format === 'case') {
    if (!writer) return { ok: false, error: 'Writing a case needs ANTHROPIC_API_KEY to be set.' };
    const { data: before } = await learn
      .from('cell_questions')
      .select('question')
      .eq('user_id', userId)
      .eq('cell_id', cellId)
      .eq('format', 'case')
      .order('created_at', { ascending: false })
      .limit(5);
    const written = await writeLevelCase({
      topicName: row.topic.name,
      level: row.level,
      descriptor: row.descriptor ?? [],
      asked: ((before ?? []) as Array<{ question: string }>).map((b) => b.question),
      anthropicApiKey: writer.anthropicApiKey,
      onSpend: writer.onSpend,
    });
    if (!written.ok) {
      console.error('[learn levels] case', written.detail);
      return { ok: false, error: 'Dash could not write a case just now.' };
    }
    text = written.case.question;
    expected = written.case.expected;
  } else {
    const explain = explainQuestion(row.topic.name, row.level);
    if (!explain) return { ok: false, error: `Level ${row.level} has no explain question.` };
    text = explain;
  }

  // The belief is the one at this moment, and the question is put in front of
  // the person as it is saved, so shown_at starts the answer clock (plan #2179.5).
  const believed = await predictedCell(learn, userId, cellId);
  const { data: inserted, error: insertError } = await learn
    .from('cell_questions')
    .insert({
      user_id: userId,
      cell_id: cellId,
      format,
      question: text,
      expected,
      piece_id: pieceId ?? null,
      shown_at: new Date().toISOString(),
      predicted_status: believed?.status ?? null,
      predicted_level: believed?.level ?? null,
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    return { ok: false, error: `Saving the question failed: ${insertError?.message ?? 'no row came back'}` };
  }
  return asked((inserted as { id: string }).id, text);
}

export type AnswerCellResult = { ok: true; moved: Moved } | { ok: false; error: string };

/**
 * Grade an answer to a cell question and write what it showed. Nothing is
 * written when grading fails, so the same answer can be sent again.
 */
export async function answerCell(
  learn: LearnSupabaseClient,
  userId: string,
  input: { questionId: string; response: string; anthropicApiKey: string; onSpend?: SpendSink },
): Promise<AnswerCellResult> {
  const response = input.response.trim();
  if (response === '') return { ok: false, error: 'Write an answer first.' };

  const { data: q, error: qError } = await learn
    .from('cell_questions')
    .select('id, cell_id, question, expected, answered_at')
    .eq('user_id', userId)
    .eq('id', input.questionId)
    .maybeSingle();
  if (qError) return { ok: false, error: `Reading the question failed: ${qError.message}` };
  const question = q as {
    id: string;
    cell_id: string;
    question: string;
    expected: string | null;
    answered_at: string | null;
  } | null;
  if (!question) return { ok: false, error: 'That question is not one of yours.' };
  if (question.answered_at) return { ok: false, error: 'That question has been answered already.' };

  let map;
  try {
    map = await loadGradeMap(learn, userId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Reading your topics failed.' };
  }
  const allCells = graderCells(map, question.cell_id);
  // A case is graded on the asked cell alone (the spec's "Cases and defences").
  const cells = allCells && question.expected ? allCells.slice(0, 1) : allCells;
  if (!cells) return { ok: false, error: 'That level is on a topic that is not approved.' };

  const gradeInput = {
    cells,
    question: question.question,
    expected: question.expected,
    answer: response,
    anthropicApiKey: input.anthropicApiKey,
    onSpend: input.onSpend,
  };
  // Two graders read every answer; only the first writes evidence. A second
  // that fails leaves its columns null and costs the person nothing.
  const [grade, second] = await Promise.all([
    gradeCellAnswer(gradeInput),
    gradeCellAnswer({ ...gradeInput, model: LEVEL_GRADE_SECOND_MODEL }),
  ]);
  if (!grade.ok) {
    console.error('[learn levels] grading', grade.detail);
    return { ok: false, error: 'Dash could not grade this answer just now.' };
  }

  const { write } = applyGradeRules({ cells, answer: response, verdicts: grade.verdicts });
  const keyToCell = new Map(cells.map((c) => [c.key, c.cellId]));
  const now = new Date().toISOString();

  // Claimed first, so two presses cannot both write evidence.
  const { data: claimed, error: claimError } = await learn
    .from('cell_questions')
    .update({
      response,
      answered_at: now,
      model: LEVEL_GRADE_MODEL,
      grade: storedGrade(grade.verdicts, keyToCell),
      grade_second: second.ok ? storedGrade(second.verdicts, keyToCell) : null,
      model_second: second.ok ? LEVEL_GRADE_SECOND_MODEL : null,
    })
    .eq('user_id', userId)
    .eq('id', question.id)
    .is('answered_at', null)
    .select('id');
  if (claimError) return { ok: false, error: `Saving your answer failed: ${claimError.message}` };
  if (!claimed || claimed.length === 0) return { ok: false, error: 'That question has been answered already.' };

  const before = readCells(map);
  let written: GradeEvidence[] = [];
  if (write.length > 0) {
    const { data: rows, error: evidenceError } = await learn
      .from('cell_evidence')
      .insert(
        write.map((w) => ({
          user_id: userId,
          cell_id: w.cellId,
          verdict: w.verdict,
          quote: w.quote,
          question_id: question.id,
          observed_at: now,
        })),
      )
      .select('id, cell_id, verdict, observed_at');
    if (evidenceError) return { ok: false, error: `Saving what your answer showed failed: ${evidenceError.message}` };
    written = ((rows ?? []) as Array<{ id: string; cell_id: string; verdict: 'met' | 'not_met'; observed_at: string }>).map(
      (r) => ({ id: r.id, cellId: r.cell_id, verdict: r.verdict, observedAt: new Date(r.observed_at).toISOString() }),
    );
  }

  const metIds = new Map(written.filter((w) => w.verdict === 'met').map((w) => [w.cellId, w.id]));
  let reviews = linkReviewsFor(map, before, metIds);
  if (reviews.length > 0) {
    const { data: openReviews } = await learn
      .from('link_reviews')
      .select('link_id')
      .eq('user_id', userId)
      .is('decision', null)
      .in(
        'link_id',
        reviews.map((r) => r.linkId),
      );
    const alreadyOpen = new Set(((openReviews ?? []) as Array<{ link_id: string }>).map((r) => r.link_id));
    reviews = reviews.filter((r) => !alreadyOpen.has(r.linkId));
  }
  if (reviews.length > 0) {
    const { error: reviewError } = await learn.from('link_reviews').insert(
      reviews.map((r) => ({
        user_id: userId,
        link_id: r.linkId,
        shown_evidence_id: r.shownEvidenceId,
        missed_evidence_id: r.missedEvidenceId,
      })),
    );
    // The evidence is written; a review that failed is found again the next
    // time the cell is shown, so the answer still counts.
    if (reviewError) {
      console.error('[learn levels] link review', reviewError.message);
      reviews = [];
    }
  }

  const after = readCells({ ...map, evidence: [...map.evidence, ...written] });
  return {
    ok: true,
    moved: whatMoved({ map, askedCellId: question.cell_id, before, after, written: write, reviews }),
  };
}

/** A grader's verdicts as kept on the row: by cell id, with quote and reason. */
function storedGrade(verdicts: readonly RawVerdict[], keyToCell: ReadonlyMap<string, string>) {
  return verdicts
    .filter((v) => keyToCell.has(v.cell))
    .map((v) => ({
      cell_id: keyToCell.get(v.cell),
      verdict: v.verdict,
      quote: v.quote ?? null,
      reason: v.reason ?? null,
    }));
}
