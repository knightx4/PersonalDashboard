import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  applyGradeRules,
  explainQuestion,
  holdGuessedMets,
  graderCells,
  linkReviewsFor,
  type GraderCell,
  whatMoved,
  type GradeEvidence,
  type RawVerdict,
  type Moved,
} from '@/lib/learn/levels/grade';
import type { RoleLine, RoleLineFinder } from '@/lib/learn/levels/role-line';
import { writeLevelCase } from '@/lib/learn/levels/case-call';
import { gradeCellAnswer, LEVEL_GRADE_MODEL, LEVEL_GRADE_SECOND_MODEL } from '@/lib/learn/levels/grade-call';
import { loadGradeMap, territoryOf } from '@/lib/learn/levels/loader-grade';
import { questionFormat, readCells } from '@/lib/learn/levels/model';
import { predictedCell } from '@/lib/learn/predicted';
import {
  figureAnswerLabel,
  figureForGrader,
  figureQuestionView,
  figureResponse,
  gradeFigureQuestion,
  poseFigureQuestion,
  readStoredFigureQuestion,
  type FigureQuestionView,
  type StoredFigureQuestion,
} from '@/lib/learn/figures/question';
import { cleanSignals, signalColumns, type AnswerSignals, type CleanSignals, type MissKind } from '@/lib/learn/confidence';
import { rowHowSure, type HowSure } from '@/lib/learn/how-sure';
import {
  earnsHint,
  hintView,
  missKindOf,
  readFirstTry,
  readHintsUsed,
  wantsHint,
  type FirstTry,
  type HintView,
} from '@/lib/learn/hint';
import { misconceptionBasis, nameMisconception } from '@/lib/learn/graph/misconception';
import { setMisconception } from '@/lib/learn/graph/session';
import { pageResolveContext } from '@/lib/learn/figures/resolve';
import { writeFigureQuestion } from '@/lib/learn/levels/figure-question-call';

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
  /**
   * What the question is: an explanation, a case to work (levels 4 to 6), or
   * a question on a figure, asked in an explanation's place (plan #2321.5).
   */
  format: 'explain' | 'case' | 'figure';
  /** The figure question without its answer, when `format` is 'figure'. */
  figure?: FigureQuestionView;
  /** The requirement line of a role you pursued that this topic serves, when one is near (plan #2184.2). */
  role?: RoleLine | null;
  /**
   * A question left open with its hint up (plan #2522.7): the hint, the first
   * try and what was said with it, so the page opens where it was left.
   */
  resume?: { hint: HintView; howSure: HowSure };
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
  /** Finds the role requirement the topic serves: shown on the question and used to set a case. */
  findRole?: RoleLineFinder,
  /**
   * `figures: false` keeps to explanations, for a screen that cannot draw a
   * figure question: the piece page's check, which has its own answer box.
   */
  options?: { figures?: boolean },
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

  // A figure question stands in for an explanation and for nothing else, so
  // it is graded no higher than one (plan #2321.5).
  const figuresAllowed = format === 'explain' && options?.figures !== false;
  const openQuery = learn
    .from('cell_questions')
    .select('id, question, format, figure, first_try, confidence, reasoning')
    .eq('user_id', userId)
    .eq('cell_id', cellId)
    .in('format', figuresAllowed ? [format, 'figure'] : [format])
    .is('answered_at', null);
  const { data: open } = await (pieceId ? openQuery.eq('piece_id', pieceId) : openQuery.is('piece_id', null))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const reuse = open as {
    id: string;
    question: string;
    format: string;
    figure: unknown;
    first_try: unknown;
    confidence: number | string | null;
    reasoning: string | null;
  } | null;
  const role = findRole ? await findRole(row.topic.name) : null;
  const asked = (
    questionId: string,
    question: string,
    figure?: FigureQuestionView | null,
    resume?: AskedCell['resume'],
  ): AskCellResult => ({
    ok: true,
    asked: {
      questionId,
      cellId,
      topicName: row.topic.name,
      level: row.level,
      question,
      format: figure ? 'figure' : format,
      ...(figure ? { figure } : {}),
      role,
      ...(resume ? { resume } : {}),
    },
  });
  if (reuse) {
    if (reuse.format !== 'figure') {
      const held = hintView(readFirstTry(reuse.first_try));
      return asked(reuse.id, reuse.question, null, held ? { hint: held, howSure: rowHowSure(reuse) } : undefined);
    }
    // A figure question whose form the app no longer has is left open and a new one asked.
    const stored = readStoredFigureQuestion(reuse.figure);
    const view = stored ? figureQuestionView(stored) : null;
    if (view) return asked(reuse.id, reuse.question, view);
  }

  let text: string;
  let expected: string | null = null;
  const figure =
    figuresAllowed && writer && (await figureTurn(learn, userId, cellId))
      ? await writeCellFigure(learn, userId, cellId, { topicName: row.topic.name, level: row.level, descriptor: row.descriptor ?? [] }, writer)
      : null;
  if (figure) {
    text = figure.prompt;
  } else if (format === 'case') {
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
      role,
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
      format: figure ? 'figure' : format,
      question: text,
      expected,
      figure,
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
  return asked((inserted as { id: string }).id, text, figure ? figureQuestionView(figure) : null);
}

/**
 * Whether the next question on a cell is a figure question: when the last
 * one answered on it was an explanation. So a cell is first explained, and
 * then the two take turns, and a figure question never comes twice running.
 */
async function figureTurn(learn: LearnSupabaseClient, userId: string, cellId: string): Promise<boolean> {
  const { data } = await learn
    .from('cell_questions')
    .select('format')
    .eq('user_id', userId)
    .eq('cell_id', cellId)
    .not('answered_at', 'is', null)
    .order('answered_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { format: string } | null)?.format === 'explain';
}

/**
 * A figure question for a cell, written and posed, or null when the writer
 * finds no form that fits, fails, or writes one the form cannot pose. A null
 * asks the explanation instead, so a failure here costs the person nothing.
 */
async function writeCellFigure(
  learn: LearnSupabaseClient,
  userId: string,
  cellId: string,
  cell: { topicName: string; level: number; descriptor: readonly string[] },
  writer: { anthropicApiKey: string; onSpend?: SpendSink },
): Promise<StoredFigureQuestion | null> {
  const { data: before } = await learn
    .from('cell_questions')
    .select('question')
    .eq('user_id', userId)
    .eq('cell_id', cellId)
    .eq('format', 'figure')
    .order('created_at', { ascending: false })
    .limit(5);
  const written = await writeFigureQuestion({
    ...cell,
    asked: ((before ?? []) as Array<{ question: string }>).map((b) => b.question),
    anthropicApiKey: writer.anthropicApiKey,
    onSpend: writer.onSpend,
  });
  if (!written.ok) {
    console.error('[learn levels] figure question', written.detail);
    return null;
  }
  if (!written.written) return null;
  return poseFigureQuestion(written.written, pageResolveContext(learn));
}

export type AnswerCellResult =
  | {
      ok: true;
      /**
       * A first written miss (plan #2522.7): nothing is recorded yet, and the
       * page shows the hint and a box to try again.
       */
      hint: HintView;
      moved?: undefined;
    }
  | {
      ok: true;
      hint?: undefined;
      moved: Moved;
      /**
       * Answered after a hint (plan #2522.7): whether it was right, which then
       * moved nothing up, and whether Show the answer recorded it.
       */
      afterHint?: { right: boolean; revealed: boolean };
      /** A case's expected answer, shown once a question that had a hint is recorded. */
      expected?: string;
      /** A figure question's answer in words, shown once it is graded (plan #2321.5). */
      answer?: string;
      /**
       * Right on the asked cell, but given at Guessing, so no met was written
       * and the ladder did not move (plan #2522.3).
       */
      guessed?: boolean;
      /**
       * Wrong on the asked cell at Fairly sure or Certain: written to the row's
       * miss_kind as 'misconception' for the next step to name (plan #2522.3).
       */
      misconceptionCandidate?: boolean;
      /** What the answer showed they believe, when it was wrong and sure or reasoned (plan #2522.4). */
      misconception?: string;
    }
  | { ok: false; error: string };

/** What `cell_questions.model` says of a figure question its form graded without a model. */
export const FIGURE_EXACT_GRADER = 'exact';

/**
 * Grade an answer to a cell question and write what it showed. Nothing is
 * written when grading fails, so the same answer can be sent again.
 */
export async function answerCell(
  learn: LearnSupabaseClient,
  userId: string,
  input: {
    questionId: string;
    response: string;
    anthropicApiKey: string;
    onSpend?: SpendSink;
    /** How sure they were and how they reasoned, when given (plan #2522.3). */
    signals?: AnswerSignals | null;
    /**
     * Show the answer (plan #2522.7): record the first try held with its hint,
     * as it was graded, without grading again. `response` is not read.
     */
    reveal?: boolean;
  },
): Promise<AnswerCellResult> {
  const { data: q, error: qError } = await learn
    .from('cell_questions')
    .select('id, cell_id, question, expected, format, figure, answered_at, hints_used, first_try, confidence, reasoning')
    .eq('user_id', userId)
    .eq('id', input.questionId)
    .maybeSingle();
  if (qError) return { ok: false, error: `Reading the question failed: ${qError.message}` };
  const question = q as {
    id: string;
    cell_id: string;
    question: string;
    expected: string | null;
    format: string;
    figure: unknown;
    answered_at: string | null;
    hints_used: number | string | null;
    first_try: unknown;
    confidence: number | string | null;
    reasoning: string | null;
  } | null;
  if (!question) return { ok: false, error: 'That question is not one of yours.' };
  if (question.answered_at) return { ok: false, error: 'That question has been answered already.' };

  const hintsUsed = readHintsUsed(question.hints_used);
  const first = readFirstTry(question.first_try);
  if (input.reveal && !first) return { ok: false, error: 'There is no hint on this question to show the answer after.' };
  // Show the answer reads what was given with the first try off the row.
  const signals = input.reveal ? rowHowSure(question) : cleanSignals(input.signals);
  const raw = input.reveal && first ? first.response : input.response.trim();
  if (raw === '') return { ok: false, error: 'Write an answer first.' };

  // A figure question keeps what was picked by its label, so the quote under
  // a met reads as the answer given (plan #2321.5).
  const figure = question.format === 'figure' ? readStoredFigureQuestion(question.figure) : null;
  if (question.format === 'figure' && !figure) return { ok: false, error: 'This question’s figure can no longer be read.' };
  const response = figure ? figureResponse(figure, raw) : raw;
  if (response === null) return { ok: false, error: 'Pick an answer first.' };

  let map;
  try {
    map = await loadGradeMap(learn, userId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Reading your topics failed.' };
  }
  const allCells = graderCells(map, question.cell_id);
  // A case is graded on the asked cell alone (the spec's "Cases and defences"),
  // and so is a figure question, which shows one thing about one level.
  const cells = allCells && (question.expected || figure) ? allCells.slice(0, 1) : allCells;
  if (!cells) return { ok: false, error: 'That level is on a topic that is not approved.' };

  const keyToCell = new Map(cells.map((c) => [c.key, c.cellId]));
  // A written answer that has had no hint yet asks the grader for one beside
  // a miss (plan #2522.7); a figure question is answered on its figure and
  // has none.
  const hintWanted = !figure && wantsHint(hintsUsed);
  const graded =
    input.reveal && first
      ? revealedGrade(first, cells)
      : figure
        ? await gradeFigure(figure, raw, response, cells, question.question, input, signals)
        : await gradeTwice(cells, question.question, question.expected, response, input, signals, {
            hint: hintWanted,
            retry: first,
          });
  if (!graded) return { ok: false, error: 'Dash could not grade this answer just now.' };

  const ruled = applyGradeRules({ cells, answer: response, verdicts: graded.verdicts });
  // Right means a met on the asked cell survived the rules.
  const askedMet = ruled.write.some((w) => w.cellId === question.cell_id && w.verdict === 'met');

  // A first miss with a hint to give is held, not recorded: the row keeps the
  // first try and the page asks again.
  const hint = graded.hint ?? null;
  if (!input.reveal && earnsHint({ correct: askedMet, hintsUsed, hint }) && hint) {
    const own = graded.verdicts.find((v) => v.cell === cells[0].key);
    const kind = missKindOf({ correct: false, confidence: signals.confidence, graderKind: graded.missKind ?? null });
    const firstTry: FirstTry = {
      response,
      why: own?.reason ?? null,
      hint,
      kind,
      grade: storedGrade(graded.verdicts, keyToCell),
    };
    const { data: kept, error: holdError } = await learn
      .from('cell_questions')
      .update({
        hints_used: hintsUsed + 1,
        miss_kind: kind,
        first_try: firstTry,
        ...(signals.confidence !== null && { confidence: signals.confidence }),
        ...(signals.reasoning !== null && { reasoning: signals.reasoning }),
      })
      .eq('user_id', userId)
      .eq('id', question.id)
      .is('answered_at', null)
      .select('id');
    if (holdError) return { ok: false, error: `Saving your answer failed: ${holdError.message}` };
    if (!kept || kept.length === 0) return { ok: false, error: 'That question has been answered already.' };
    return { ok: true, hint: { hint, response } };
  }

  // The guess rule keeps every met back at Guessing, and so does a hint: right
  // after one counts as right and leaves the ladder where it was.
  const hinted = hintsUsed > 0;
  const { write, held } = holdGuessedMets(ruled.write, signals.confidence, hinted);
  const guessed = !hinted && held.some((w) => w.cellId === question.cell_id);
  const signalled = signalColumns(signals, askedMet);
  // The row's kind of miss: this answer's when it missed, else the first
  // try's, so a right answer after a hint still says what the miss was.
  const missKind = askedMet
    ? (first?.kind ?? null)
    : missKindOf({ correct: false, confidence: signals.confidence, graderKind: graded.missKind ?? first?.kind ?? null });
  const now = new Date().toISOString();

  // Claimed first, so two presses cannot both write evidence.
  const { data: claimed, error: claimError } = await learn
    .from('cell_questions')
    .update({
      response,
      answered_at: now,
      model: graded.model,
      grade: storedGrade(graded.verdicts, keyToCell),
      grade_second: graded.second ? storedGrade(graded.second, keyToCell) : null,
      model_second: graded.second ? LEVEL_GRADE_SECOND_MODEL : null,
      ...signalled,
      miss_kind: missKind,
      ...(input.reveal && first && { first_try: { ...first, revealed: true } }),
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
  const misconception = askedMet
    ? undefined
    : await nameCellMisconception(learn, userId, {
        cell: cells[0],
        question: question.question,
        response,
        signals,
        anthropicApiKey: input.anthropicApiKey,
        onSpend: input.onSpend,
      });
  return {
    ok: true,
    moved: whatMoved({ map, askedCellId: question.cell_id, before, after, written: write, reviews }),
    ...(misconception ? { misconception } : {}),
    ...(figure ? { answer: figureAnswerLabel(figure) } : {}),
    ...(guessed ? { guessed: true } : {}),
    ...(signalled.miss_kind === 'misconception' ? { misconceptionCandidate: true } : {}),
    ...(hinted ? { afterHint: { right: askedMet, revealed: input.reveal === true } } : {}),
    // A case's expected answer is shown once a question that had a hint is
    // recorded, the way a piece's check and review show theirs.
    ...(hinted && question.expected ? { expected: question.expected } : {}),
  };
}

/**
 * The first try's grade, read back for Show the answer: the verdicts it kept
 * by cell id, turned back into the grader's keys. The asked cell keeps a not
 * met whatever else could not be matched.
 */
function revealedGrade(first: FirstTry, cells: readonly GraderCell[]): Graded {
  const cellToKey = new Map(cells.map((c) => [c.cellId, c.key]));
  const kept = Array.isArray(first.grade) ? (first.grade as Array<Record<string, unknown>>) : [];
  const verdicts: RawVerdict[] = [];
  for (const v of kept) {
    const key = typeof v.cell_id === 'string' ? cellToKey.get(v.cell_id) : undefined;
    if (!key || (v.verdict !== 'met' && v.verdict !== 'not_met' && v.verdict !== 'not_touched')) continue;
    verdicts.push({
      cell: key,
      verdict: v.verdict,
      quote: typeof v.quote === 'string' ? v.quote : null,
      reason: typeof v.reason === 'string' ? v.reason : null,
    });
  }
  if (!verdicts.some((v) => v.cell === cells[0].key)) {
    verdicts.push({ cell: cells[0].key, verdict: 'not_met', quote: null, reason: first.why });
  }
  return { verdicts, model: LEVEL_GRADE_MODEL, second: null };
}

/**
 * Name what a wrong answer to a cell question shows, when it was given sure
 * or with reasoning (plan #2522.4). A cell question has no repeat to wait for.
 * The sentence is kept on the cell's claim when the cell has exactly one idea
 * on it; with several there is no telling which one it is about, so it is
 * handed back for the page and stored nowhere. Never throws: the answer is
 * already saved, and a belief that could not be named loses a sentence only.
 */
async function nameCellMisconception(
  learn: LearnSupabaseClient,
  userId: string,
  input: {
    cell: { cellId: string; topicName: string; level: number; descriptor: readonly string[] };
    question: string;
    response: string;
    signals: CleanSignals;
    anthropicApiKey: string;
    onSpend?: SpendSink;
  },
): Promise<string | undefined> {
  const basis = misconceptionBasis({
    correct: false,
    confidence: input.signals.confidence,
    reasoning: input.signals.reasoning,
  });
  if (!basis) return undefined;
  try {
    const named = await nameMisconception({
      concept: `${input.cell.topicName}, level ${input.cell.level}`,
      claim: input.cell.descriptor.join(' '),
      wrongAnswer: input.response,
      questions: [input.question],
      reasoning: input.signals.reasoning ? [input.signals.reasoning] : undefined,
      basis,
      anthropicApiKey: input.anthropicApiKey,
      onSpend: input.onSpend,
    });
    if (!named.ok) return undefined;
    const claims = await learn
      .from('cell_claims')
      .select('concept_id')
      .eq('user_id', userId)
      .eq('cell_id', input.cell.cellId)
      .not('concept_id', 'is', null);
    const ids = ((claims.data ?? []) as Array<{ concept_id: string }>).map((r) => r.concept_id);
    if (ids.length === 1) await setMisconception(learn, userId, ids[0], named.misconception);
    return named.misconception;
  } catch {
    return undefined;
  }
}

type Graded = {
  verdicts: RawVerdict[];
  model: string;
  second: RawVerdict[] | null;
  /** The first grader's hint and kind of miss, when one was asked for (plan #2522.7). */
  hint?: string | null;
  missKind?: MissKind | null;
};
type GradeKey = { anthropicApiKey: string; onSpend?: SpendSink };

/**
 * An explanation or a case: two graders read it and only the first writes
 * evidence. A second that fails leaves its columns null and costs the person
 * nothing. Null when the first fails.
 */
async function gradeTwice(
  cells: GraderCell[],
  question: string,
  expected: string | null,
  answer: string,
  key: GradeKey,
  signals: CleanSignals,
  /** A hint asked of the first grader, and the first try on a retry (plan #2522.7). */
  turn: { hint: boolean; retry: FirstTry | null } = { hint: false, retry: null },
): Promise<Graded | null> {
  const gradeInput = {
    cells,
    question,
    expected,
    answer,
    signals,
    retry: turn.retry,
    anthropicApiKey: key.anthropicApiKey,
    onSpend: key.onSpend,
  };
  const [grade, second] = await Promise.all([
    gradeCellAnswer({ ...gradeInput, hint: turn.hint }),
    gradeCellAnswer({ ...gradeInput, model: LEVEL_GRADE_SECOND_MODEL }),
  ]);
  if (!grade.ok) {
    console.error('[learn levels] grading', grade.detail);
    return null;
  }
  return {
    verdicts: grade.verdicts,
    model: LEVEL_GRADE_MODEL,
    second: second.ok ? second.verdicts : null,
    hint: grade.hint ?? null,
    missKind: grade.missKind ?? null,
  };
}

/**
 * A figure question (plan #2321.5), on the asked cell alone: by its form's
 * grader where the answer is exact, with the response itself as the quote,
 * and otherwise by the model with the figure and its answer in the prompt.
 * Either way the verdict goes through the same rules as an explanation's.
 */
async function gradeFigure(
  figure: StoredFigureQuestion,
  raw: string,
  response: string,
  cells: GraderCell[],
  question: string,
  key: GradeKey,
  signals: CleanSignals,
): Promise<Graded | null> {
  const asked = cells[0];
  // Reasoning needs reading, which the exact grader cannot do, so an answer
  // that came with reasoning goes to the model (plan #2522.3).
  const exact = signals.reasoning === null ? gradeFigureQuestion(figure, raw) : null;
  if (exact) {
    return {
      verdicts: [
        {
          cell: asked.key,
          verdict: exact,
          quote: exact === 'met' ? response : null,
          reason: exact === 'met' ? 'The answer the figure holds.' : `The figure holds ${figureAnswerLabel(figure)}.`,
        },
      ],
      model: FIGURE_EXACT_GRADER,
      second: null,
    };
  }
  const grade = await gradeCellAnswer({
    cells,
    question,
    figure: figureForGrader(figure),
    answer: response,
    signals,
    anthropicApiKey: key.anthropicApiKey,
    onSpend: key.onSpend,
  });
  if (!grade.ok) {
    console.error('[learn levels] grading a figure question', grade.detail);
    return null;
  }
  return { verdicts: grade.verdicts, model: LEVEL_GRADE_MODEL, second: null };
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
