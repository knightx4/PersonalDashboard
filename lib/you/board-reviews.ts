import type { BoardReceipt } from '@/lib/you/board';
import { optionsOf, type BoardOption } from '@/lib/you/board-questions';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  believabilityFrom,
  believabilityOf,
  loadForecasts,
  sameBelievability,
  scoreForecasts,
  type ForecastScore,
} from '@/lib/you/board-scoring';

/**
 * The board checking back on a decision (you.board_questions.reviews and
 * topic, migrations-you/0026, plan #2561.8). A decided question is reviewed
 * 30 and 90 days after the decision. The Sunday meeting writes the review:
 * how it turned out, from the person's rows, with receipts, and one line put
 * to them (.claude/skills/board/SKILL.md). The person answers it on the
 * Board tab with well, mixed or badly, and each advisor's final pick on the
 * question is graded against that answer, for the scorecard's "Picks that
 * held up".
 *
 * Since plan #2581.10 a decision whose advisors gave probabilities is scored
 * instead of graded: the answer Brier-scores each advisor's forecast for the
 * chosen option (lib/you/board-scoring.ts) and their believability by topic
 * is worked out again. A check-back falls due on its day whether or not a
 * meeting has written its account yet, so the person can answer it on the
 * day the daily notification names it; the entry is then written with no
 * account.
 *
 * A board session writes the reviews through scripts/sql.ts, so rows are
 * read defensively: an entry of the wrong shape is dropped and the rest kept.
 */

export const REVIEW_DAYS = [30, 90] as const;
export type ReviewAt = (typeof REVIEW_DAYS)[number];

export const OUTCOMES = ['well', 'mixed', 'badly'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  well: 'Went well',
  mixed: 'Mixed',
  badly: 'Went badly',
};

export const TOPICS = ['work', 'money', 'learning', 'projects', 'place', 'time'] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS: Record<Topic, string> = {
  work: 'Work',
  money: 'Money',
  learning: 'Learning',
  projects: 'Projects',
  place: 'Place',
  time: 'Time',
};

export type ReviewGrade = {
  advisor: string;
  /** The option the advisor scored highest in round 3, or null on a tie. */
  pick: string | null;
  /** Whether the pick held up; null when the outcome was mixed or there was no single pick. */
  held: boolean | null;
};

export type BoardReview = {
  at: ReviewAt;
  /** The decided option the review looked at. */
  option: string | null;
  meetingId: string | null;
  writtenAt: string | null;
  account: string;
  receipts: BoardReceipt[];
  ask: string;
  outcome: Outcome | null;
  answeredAt: string | null;
  grades: ReviewGrade[];
  /** Each advisor's forecast scored against the answer (plan #2581.10); empty on an older decision. */
  scores: ForecastScore[];
};

/** A review with the decision it is about, for the tab. */
export type DecisionReview = BoardReview & {
  questionId: string;
  question: string;
  options: BoardOption[];
  chosen: string | null;
  decidedAt: string | null;
  topic: Topic | null;
  /** How the person said they would know it went well; set on decisions since plan #2581.8. */
  successMeasure: string | null;
  /** The day the check-back fell due, as an ISO date. */
  due: string | null;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const oneOf = <T extends string>(words: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (words as readonly string[]).includes(value) ? (value as T) : null;

export function topicOf(value: unknown): Topic | null {
  return oneOf(TOPICS, value);
}

function receiptsOf(value: unknown): BoardReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const label = text(r.label);
    const link = text(r.link);
    return label && link ? [{ label, link }] : [];
  });
}

function scoresOf(value: unknown): ForecastScore[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const advisor = text(r.advisor);
    if (!advisor || typeof r.probability !== 'number' || typeof r.brier !== 'number') return [];
    return [{ advisor, probability: r.probability, brier: r.brier }];
  });
}

function gradesOf(value: unknown): ReviewGrade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const advisor = text(r.advisor);
    if (!advisor) return [];
    return [
      {
        advisor,
        pick: text(r.pick) || null,
        held: typeof r.held === 'boolean' ? r.held : null,
      },
    ];
  });
}

export function reviewsOf(value: unknown): BoardReview[] {
  if (!Array.isArray(value)) return [];
  const out: BoardReview[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const at = r.at === 30 || r.at === 90 ? r.at : null;
    const account = text(r.account);
    const outcome = oneOf(OUTCOMES, r.outcome);
    // An entry with no account is one the person answered before a meeting wrote it.
    if (!at || (!account && !outcome) || out.some((x) => x.at === at)) continue;
    out.push({
      at,
      option: text(r.option) || null,
      meetingId: typeof r.meeting_id === 'string' ? r.meeting_id : null,
      writtenAt: typeof r.written_at === 'string' ? r.written_at : null,
      account,
      receipts: receiptsOf(r.receipts),
      ask: text(r.ask),
      outcome,
      answeredAt: outcome && typeof r.answered_at === 'string' ? r.answered_at : null,
      grades: outcome ? gradesOf(r.grades) : [],
      scores: outcome ? scoresOf(r.scores) : [],
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function reviewsToJson(reviews: readonly BoardReview[]) {
  return reviews.map((r) => ({
    at: r.at,
    option: r.option,
    meeting_id: r.meetingId,
    written_at: r.writtenAt,
    account: r.account,
    receipts: r.receipts,
    ask: r.ask,
    outcome: r.outcome,
    answered_at: r.answeredAt,
    grades: r.grades,
    scores: r.scores,
  }));
}

const DAY = 24 * 60 * 60 * 1000;

/** The two days the board checks back on a decision, as ISO dates. */
export function reviewDates(decidedAt: string): { at: ReviewAt; due: string }[] {
  const start = Date.parse(decidedAt);
  if (Number.isNaN(start)) return [];
  return REVIEW_DAYS.map((at) => ({ at, due: new Date(start + at * DAY).toISOString().slice(0, 10) }));
}

/** The next check-back still to be written, or null when both are. */
export function nextReview(
  decidedAt: string,
  reviews: readonly { at: number }[],
): { at: ReviewAt; due: string } | null {
  return reviewDates(decidedAt).find((d) => !reviews.some((r) => r.at === d.at)) ?? null;
}

/** The option an advisor scored highest, or null when two share the top score or none is scored. */
export function pickOf(scores: Record<string, unknown> | null | undefined): string | null {
  if (!scores) return null;
  let best: string | null = null;
  let top = -Infinity;
  let tied = false;
  for (const [letter, value] of Object.entries(scores)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (value > top) {
      top = value;
      best = letter;
      tied = false;
    } else if (value === top) tied = true;
  }
  return tied ? null : best;
}

/**
 * Each advisor's round 3 pick graded against how the decision went. A pick
 * held up when the decision went well and they backed it, or went badly and
 * they backed something else. A mixed outcome, or no single pick, grades
 * nothing either way.
 */
export function gradeReview(
  verdictScores: unknown,
  decided: string | null,
  outcome: Outcome,
): ReviewGrade[] {
  if (!Array.isArray(verdictScores)) return [];
  const out: ReviewGrade[] = [];
  for (const entry of verdictScores) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const advisor = text(r.advisor);
    if (!advisor || out.some((g) => g.advisor === advisor)) continue;
    const pick = pickOf(
      r.scores && typeof r.scores === 'object' ? (r.scores as Record<string, unknown>) : null,
    );
    const held =
      pick === null || decided === null || outcome === 'mixed'
        ? null
        : outcome === 'well'
          ? pick === decided
          : pick !== decided;
    out.push({ advisor, pick, held });
  }
  return out;
}

/** The reviews with one answered, graded and scored, or null when there is no such review. */
export function withOutcome(
  reviews: readonly BoardReview[],
  at: ReviewAt,
  outcome: Outcome,
  grades: ReviewGrade[],
  when: string,
  scores: ForecastScore[] = [],
): BoardReview[] | null {
  if (!reviews.some((r) => r.at === at)) return null;
  return reviews.map((r) => (r.at === at ? { ...r, outcome, answeredAt: when, grades, scores } : r));
}

/** A check-back that fell due before any meeting wrote it, as the entry the person's answer starts. */
export function blankReview(at: ReviewAt, option: string | null): BoardReview {
  return {
    at,
    option,
    meetingId: null,
    writtenAt: null,
    account: '',
    receipts: [],
    ask: '',
    outcome: null,
    answeredAt: null,
    grades: [],
    scores: [],
  };
}

/** The check-backs due by `today` (an ISO date) that no meeting has written, oldest first. */
export function dueUnwritten(
  decidedAt: string,
  reviews: readonly { at: number }[],
  today: string,
): { at: ReviewAt; due: string }[] {
  return reviewDates(decidedAt).filter((d) => d.due <= today && !reviews.some((r) => r.at === d.at));
}

/** The line put to the person: the meeting's, or one built from the success measure. */
export function reviewAsk(review: Pick<DecisionReview, 'ask' | 'successMeasure'>): string {
  if (review.ask) return review.ask;
  return review.successMeasure
    ? `You said you would know it went well if: ${review.successMeasure.replace(/[.\s]+$/, '')}. Did it?`
    : 'Did this decision go well?';
}

/** The three answers' words: met or not when the advisors forecast a success measure. */
export function outcomeLabels(review: Pick<DecisionReview, 'successMeasure'>): Record<Outcome, string> {
  return review.successMeasure ? { well: 'Met it', mixed: 'Partly', badly: 'Did not' } : OUTCOME_LABELS;
}

export type PickScore = {
  advisor: string;
  held: number;
  graded: number;
  topics: { topic: Topic | null; held: number; graded: number }[];
};

/**
 * How often each advisor's pick held up, overall and by topic. Each question
 * counts once, by its latest answered review, so a 90-day answer replaces the
 * 30-day one. Ungraded picks (a mixed outcome, a tie) are left out.
 */
export function pickScorecard(
  questions: readonly { topic: Topic | null; reviews: readonly BoardReview[] }[],
): PickScore[] {
  const byAdvisor = new Map<string, PickScore>();
  for (const question of questions) {
    const latest = [...question.reviews].reverse().find((r) => r.outcome !== null);
    if (!latest) continue;
    for (const grade of latest.grades) {
      if (grade.held === null) continue;
      const score = byAdvisor.get(grade.advisor) ?? { advisor: grade.advisor, held: 0, graded: 0, topics: [] };
      score.graded += 1;
      if (grade.held) score.held += 1;
      let topic = score.topics.find((t) => t.topic === question.topic);
      if (!topic) {
        topic = { topic: question.topic, held: 0, graded: 0 };
        score.topics.push(topic);
      }
      topic.graded += 1;
      if (grade.held) topic.held += 1;
      byAdvisor.set(grade.advisor, score);
    }
  }
  const rank = (t: Topic | null) => (t ? TOPICS.indexOf(t) : TOPICS.length);
  return [...byAdvisor.values()]
    .map((s) => ({ ...s, topics: [...s.topics].sort((a, b) => rank(a.topic) - rank(b.topic)) }))
    .sort((a, b) => b.graded - a.graded || a.advisor.localeCompare(b.advisor));
}

/** "2 of 3", or "1 of 1". */
export function heldLine(held: number, graded: number): string {
  return `${held} of ${graded}`;
}

/** "Work 2 of 2 · Money 0 of 1", topics with none set last as "Other". */
export function topicsLine(score: PickScore): string {
  return score.topics
    .map((t) => `${t.topic ? TOPIC_LABELS[t.topic] : 'Other'} ${heldLine(t.held, t.graded)}`)
    .join(' · ');
}

const REVIEW_COLUMNS =
  'id, question, options, decided_option, decided_at, topic, success_measure, reviews, verdict, updated_at';

/** Every check-back on a decided row: those written, and with `today`, those due and not written yet. */
export function decisionReviews(row: Record<string, unknown>, today?: string): DecisionReview[] {
  if (typeof row.id !== 'string') return [];
  const decidedAt = typeof row.decided_at === 'string' ? row.decided_at : null;
  const chosen = text(row.decided_option) || null;
  const written = reviewsOf(row.reviews);
  const dueOn = (at: number) =>
    decidedAt ? (reviewDates(decidedAt).find((d) => d.at === at)?.due ?? null) : null;
  const pending =
    today && decidedAt ? dueUnwritten(decidedAt, written, today).map((d) => blankReview(d.at, chosen)) : [];
  return [...written, ...pending]
    .sort((a, b) => a.at - b.at)
    .map((review) => ({
      ...review,
      questionId: row.id as string,
      question: text(row.question),
      options: optionsOf(row.options),
      chosen,
      decidedAt,
      topic: topicOf(row.topic),
      successMeasure: text(row.success_measure) || null,
      due: dueOn(review.at),
    }));
}

async function decidedRows(client: YouSupabaseClient, userId: string) {
  const { data, error } = await client
    .from('board_questions')
    .select(REVIEW_COLUMNS)
    .eq('user_id', userId)
    .eq('status', 'decided')
    .order('decided_at', { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * Which of one decision's check-backs still wait on an answer: the latest
 * unanswered one, unless a later one is already answered, since the later
 * answer is the one that counts.
 */
export function openReviews<T extends { at: number; outcome: Outcome | null }>(reviews: readonly T[]): T[] {
  const answered = Math.max(0, ...reviews.filter((r) => r.outcome !== null).map((r) => r.at));
  return reviews.filter((r) => r.outcome === null && r.at > answered).slice(-1);
}

/**
 * The check-backs waiting on the person's answer, written or only due, the
 * earliest due first. Where both of a decision's are open, only the 90-day
 * one is listed: its answer is the one that counts.
 */
export async function listOpenReviews(
  client: YouSupabaseClient,
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DecisionReview[]> {
  return (await decidedRows(client, userId))
    .flatMap((row) => openReviews(decisionReviews(row, today)))
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
}

/** The check-backs a meeting wrote, answered or not. */
export async function listMeetingReviews(
  client: YouSupabaseClient,
  userId: string,
  meetingId: string,
): Promise<DecisionReview[]> {
  return (await decidedRows(client, userId))
    .flatMap((row) => decisionReviews(row))
    .filter((r) => r.meetingId === meetingId);
}

/** Every advisor's name by key, those taken off the board included, so an old grade still reads. */
export async function advisorNames(client: YouSupabaseClient, userId: string): Promise<Record<string, string>> {
  const { data, error } = await client.from('board_advisors').select('key, name').eq('user_id', userId);
  if (error) throw new Error(error.message);
  const names: Record<string, string> = {};
  for (const a of (data ?? []) as Record<string, unknown>[]) {
    if (typeof a.key === 'string' && typeof a.name === 'string') names[a.key] = a.name;
  }
  return names;
}

/** The picks scorecard across every decision of theirs. */
export async function loadPickScorecard(client: YouSupabaseClient, userId: string): Promise<PickScore[]> {
  const rows = await decidedRows(client, userId);
  return pickScorecard(rows.map((row) => ({ topic: topicOf(row.topic), reviews: reviewsOf(row.reviews) })));
}

/**
 * Work out every advisor's believability again from each decision's latest
 * answered scores, and write the ones that changed. Reads every question with
 * a check-back, whatever its status, so a decision reopened by its tripwire
 * keeps the scores it earned.
 */
export async function rescoreBelievability(
  client: YouSupabaseClient,
  userId: string,
  when: string = new Date().toISOString(),
): Promise<number> {
  const { data, error } = await client
    .from('board_questions')
    .select('topic, reviews')
    .eq('user_id', userId)
    .neq('reviews', '[]')
    .limit(1000);
  if (error) throw new Error(error.message);
  const questions = ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const latest = [...reviewsOf(row.reviews)].reverse().find((r) => r.outcome !== null);
    return { topic: topicOf(row.topic), scores: latest?.scores ?? [] };
  });
  const next = believabilityFrom(questions, when);
  const { data: advisors, error: advisorError } = await client
    .from('board_advisors')
    .select('id, key, believability')
    .eq('user_id', userId);
  if (advisorError) throw new Error(advisorError.message);
  let written = 0;
  for (const advisor of (advisors ?? []) as { id: string; key: string; believability: unknown }[]) {
    const fresh = next.get(advisor.key) ?? {};
    if (sameBelievability(believabilityOf(advisor.believability), fresh)) continue;
    const { error: writeError } = await client
      .from('board_advisors')
      .update({ believability: fresh })
      .eq('user_id', userId)
      .eq('id', advisor.id);
    if (writeError) throw new Error(writeError.message);
    written += 1;
  }
  return written;
}

/**
 * Save the person's answer to one check-back and grade each advisor's pick
 * against it, or, on a decision the advisors forecast, score each forecast
 * and work their believability out again. A check-back that fell due before
 * a meeting wrote it is started by the answer. Writes only if the row has not changed since it was read, so a
 * meeting writing at the same moment is not overwritten.
 */
export async function answerReview(
  client: YouSupabaseClient,
  userId: string,
  questionId: string,
  at: ReviewAt,
  outcome: Outcome,
  when: string = new Date().toISOString(),
): Promise<'saved' | 'missing' | 'changed'> {
  const { data, error } = await client
    .from('board_questions')
    .select(REVIEW_COLUMNS)
    .eq('user_id', userId)
    .eq('id', questionId)
    .eq('status', 'decided')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return 'missing';
  const row = data as Record<string, unknown>;
  const reviews = reviewsOf(row.reviews);
  let review = reviews.find((r) => r.at === at);
  if (!review) {
    const decidedAt = typeof row.decided_at === 'string' ? row.decided_at : '';
    if (!dueUnwritten(decidedAt, reviews, when.slice(0, 10)).some((d) => d.at === at)) return 'missing';
    review = blankReview(at, text(row.decided_option) || null);
    reviews.push(review);
    reviews.sort((a, b) => a.at - b.at);
  }
  const decided = review.option ?? (text(row.decided_option) || null);
  const forecasts = await loadForecasts(client, userId, questionId);
  const verdict = row.verdict && typeof row.verdict === 'object' ? (row.verdict as Record<string, unknown>) : {};
  const next =
    forecasts.length > 0
      ? withOutcome(reviews, at, outcome, [], when, scoreForecasts(forecasts, decided, outcome))
      : withOutcome(reviews, at, outcome, gradeReview(verdict.scores, decided, outcome), when);
  if (!next) return 'missing';
  const { data: written, error: writeError } = await client
    .from('board_questions')
    .update({ reviews: reviewsToJson(next) })
    .eq('user_id', userId)
    .eq('id', questionId)
    .eq('updated_at', row.updated_at as string)
    .select('id');
  if (writeError) throw new Error(writeError.message);
  if ((written ?? []).length === 0) return 'changed';
  if (forecasts.length > 0) await rescoreBelievability(client, userId, when);
  return 'saved';
}
