import type { BoardReceipt } from '@/lib/you/board';
import { optionsOf, type BoardOption } from '@/lib/you/board-questions';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

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
};

/** A review with the decision it is about, for the tab. */
export type DecisionReview = BoardReview & {
  questionId: string;
  question: string;
  options: BoardOption[];
  chosen: string | null;
  decidedAt: string | null;
  topic: Topic | null;
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
    if (!at || !account || out.some((x) => x.at === at)) continue;
    const outcome = oneOf(OUTCOMES, r.outcome);
    out.push({
      at,
      option: text(r.option) || null,
      meetingId: typeof r.meeting_id === 'string' ? r.meeting_id : null,
      writtenAt: typeof r.written_at === 'string' ? r.written_at : null,
      account,
      receipts: receiptsOf(r.receipts),
      ask: text(r.ask) || 'Did this decision go well?',
      outcome,
      answeredAt: outcome && typeof r.answered_at === 'string' ? r.answered_at : null,
      grades: outcome ? gradesOf(r.grades) : [],
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

/** The reviews with one answered and graded, or null when there is no such review. */
export function withOutcome(
  reviews: readonly BoardReview[],
  at: ReviewAt,
  outcome: Outcome,
  grades: ReviewGrade[],
  when: string,
): BoardReview[] | null {
  if (!reviews.some((r) => r.at === at)) return null;
  return reviews.map((r) => (r.at === at ? { ...r, outcome, answeredAt: when, grades } : r));
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

const REVIEW_COLUMNS = 'id, question, options, decided_option, decided_at, topic, reviews, verdict, updated_at';

function decisionReviews(row: Record<string, unknown>): DecisionReview[] {
  if (typeof row.id !== 'string') return [];
  return reviewsOf(row.reviews).map((review) => ({
    ...review,
    questionId: row.id as string,
    question: text(row.question),
    options: optionsOf(row.options),
    chosen: text(row.decided_option) || null,
    decidedAt: typeof row.decided_at === 'string' ? row.decided_at : null,
    topic: topicOf(row.topic),
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

/** The check-backs written and waiting on the person's answer, oldest decision first. */
export async function listOpenReviews(client: YouSupabaseClient, userId: string): Promise<DecisionReview[]> {
  return (await decidedRows(client, userId)).flatMap(decisionReviews).filter((r) => r.outcome === null);
}

/** The check-backs a meeting wrote, answered or not. */
export async function listMeetingReviews(
  client: YouSupabaseClient,
  userId: string,
  meetingId: string,
): Promise<DecisionReview[]> {
  return (await decidedRows(client, userId)).flatMap(decisionReviews).filter((r) => r.meetingId === meetingId);
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
 * Save the person's answer to one check-back and grade each advisor's pick
 * against it. Writes only if the row has not changed since it was read, so a
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
  const review = reviews.find((r) => r.at === at);
  if (!review) return 'missing';
  const verdict = row.verdict && typeof row.verdict === 'object' ? (row.verdict as Record<string, unknown>) : {};
  const decided = review.option ?? (text(row.decided_option) || null);
  const next = withOutcome(reviews, at, outcome, gradeReview(verdict.scores, decided, outcome), when);
  if (!next) return 'missing';
  const { data: written, error: writeError } = await client
    .from('board_questions')
    .update({ reviews: reviewsToJson(next) })
    .eq('user_id', userId)
    .eq('id', questionId)
    .eq('updated_at', row.updated_at as string)
    .select('id');
  if (writeError) throw new Error(writeError.message);
  return (written ?? []).length > 0 ? 'saved' : 'changed';
}
