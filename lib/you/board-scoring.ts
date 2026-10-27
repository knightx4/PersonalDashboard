import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { TOPICS, type Outcome, type Topic } from '@/lib/you/board-reviews';

/**
 * Scoring the advisors' forecasts once the person says how a decision went
 * (plan #2581.10). Since #2581.8 every advisor on a decision gives a
 * probability, per option, that the option meets the question's success
 * measure. When the person answers a check-back, each advisor's latest turn
 * with probabilities on the question is read, and their probability for the
 * option the person chose is Brier-scored against the answer: Went well
 * counts as met (1), Went badly as not met (0), and Mixed scores nothing.
 *
 * Believability is then worked out again from every answered decision, so a
 * changed answer, or a 90-day answer replacing a 30-day one, never counts a
 * forecast twice: { <topic>: { scored, brier, updated_at } } on
 * you.board_advisors, brier the mean (0 best, 0.25 a coin, 1 worst). The
 * board's weights read it (.claude/skills/board/SKILL.md, step 10).
 */

export type ForecastScore = {
  /** The advisor's key. */
  advisor: string;
  /** Their probability that the chosen option met the success measure. */
  probability: number;
  /** (probability - outcome)², 0 best and 1 worst. */
  brier: number;
};

export type TopicRecord = { scored: number; brier: number; updated_at: string };
export type Believability = Partial<Record<Topic, TopicRecord>>;

/** An advisor's final forecast on a question: their latest turn with probabilities. */
export type Forecast = { advisor: string; probabilities: Record<string, number> };

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** The number an answer scores against, or null when it scores nothing. */
export function outcomeValue(outcome: Outcome): 0 | 1 | null {
  return outcome === 'well' ? 1 : outcome === 'badly' ? 0 : null;
}

export function brier(probability: number, outcome: 0 | 1): number {
  return round4((probability - outcome) ** 2);
}

function probabilitiesOf(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [letter, p] of Object.entries(value as Record<string, unknown>)) {
    if (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1) out[letter] = p;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Each advisor's latest turn with probabilities, from turns already ordered
 * oldest first. A question reopened and taken up again keeps its last word.
 */
export function latestForecasts(
  turns: readonly { advisor: string; probabilities: unknown }[],
): Forecast[] {
  const last = new Map<string, Forecast>();
  for (const turn of turns) {
    const probabilities = probabilitiesOf(turn.probabilities);
    if (turn.advisor && probabilities) last.set(turn.advisor, { advisor: turn.advisor, probabilities });
  }
  return [...last.values()];
}

/** Every forecast that named the chosen option, scored against the answer. */
export function scoreForecasts(
  forecasts: readonly Forecast[],
  chosen: string | null,
  outcome: Outcome,
): ForecastScore[] {
  const o = outcomeValue(outcome);
  if (o === null || !chosen) return [];
  return forecasts.flatMap((f) => {
    const p = f.probabilities[chosen];
    return typeof p === 'number' ? [{ advisor: f.advisor, probability: p, brier: brier(p, o) }] : [];
  });
}

/**
 * Believability by advisor and topic from every decision's latest answered
 * scores. A decision with no topic counts toward no topic, since the weights
 * are read by topic.
 */
export function believabilityFrom(
  questions: readonly { topic: Topic | null; scores: readonly ForecastScore[] }[],
  when: string,
): Map<string, Believability> {
  const sums = new Map<string, Map<Topic, { n: number; total: number }>>();
  for (const q of questions) {
    if (!q.topic) continue;
    for (const s of q.scores) {
      const byTopic = sums.get(s.advisor) ?? new Map();
      const t = byTopic.get(q.topic) ?? { n: 0, total: 0 };
      t.n += 1;
      t.total += s.brier;
      byTopic.set(q.topic, t);
      sums.set(s.advisor, byTopic);
    }
  }
  const out = new Map<string, Believability>();
  for (const [advisor, byTopic] of sums) {
    const record: Believability = {};
    for (const topic of TOPICS) {
      const t = byTopic.get(topic);
      if (t) record[topic] = { scored: t.n, brier: round4(t.total / t.n), updated_at: when };
    }
    out.set(advisor, record);
  }
  return out;
}

/** A believability as stored, read defensively. */
export function believabilityOf(value: unknown): Believability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Believability = {};
  for (const topic of TOPICS) {
    const r = (value as Record<string, unknown>)[topic];
    if (!r || typeof r !== 'object') continue;
    const { scored, brier: b, updated_at } = r as Record<string, unknown>;
    if (typeof scored === 'number' && scored > 0 && typeof b === 'number') {
      out[topic] = { scored, brier: b, updated_at: typeof updated_at === 'string' ? updated_at : '' };
    }
  }
  return out;
}

/** Whether two believabilities hold the same counts and scores, ignoring when. */
export function sameBelievability(a: Believability, b: Believability): boolean {
  return TOPICS.every((t) => {
    const x = a[t];
    const y = b[t];
    if (!x || !y) return !x && !y;
    return x.scored === y.scored && x.brier === y.brier;
  });
}

/** Forecasts scored before they count toward an advisor's weight (SKILL.md, step 10). */
export const WEIGHT_AFTER = 5;

/** The weight the board gives an advisor on a topic: 1 until five are scored, then (0.5 - brier) / 0.25 within 0.25 to 2. */
export function weightOf(record: TopicRecord | undefined): number {
  if (!record || record.scored < WEIGHT_AFTER) return 1;
  return Math.max(0.25, Math.min(2, (0.5 - record.brier) / 0.25));
}

export type TrackRecord = {
  advisor: string;
  name: string;
  /** Every forecast scored, across topics. */
  scored: number;
  /** Mean Brier across topics, weighted by count. */
  brier: number;
  topics: { topic: Topic; scored: number; brier: number; weight: number }[];
};

/**
 * The leaderboard: every advisor with a scored forecast, best mean Brier
 * first, then most scored. Topics in their usual order.
 */
export function trackRecords(
  advisors: readonly { key: string; name: string; believability: unknown }[],
): TrackRecord[] {
  return advisors
    .flatMap((a) => {
      const b = believabilityOf(a.believability);
      const topics = TOPICS.flatMap((topic) => {
        const r = b[topic];
        return r ? [{ topic, scored: r.scored, brier: r.brier, weight: weightOf(r) }] : [];
      });
      if (topics.length === 0) return [];
      const scored = topics.reduce((n, t) => n + t.scored, 0);
      const total = topics.reduce((n, t) => n + t.brier * t.scored, 0);
      return [{ advisor: a.key, name: a.name, scored, brier: round4(total / scored), topics }];
    })
    .sort((x, y) => x.brier - y.brier || y.scored - x.scored || x.name.localeCompare(y.name));
}

/** Each advisor's final forecast on one question, by key. */
export async function loadForecasts(
  client: YouSupabaseClient,
  userId: string,
  questionId: string,
): Promise<Forecast[]> {
  const { data, error } = await client
    .from('board_turns')
    .select('advisor_id, probabilities, created_at, position')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .not('probabilities', 'is', null)
    .order('created_at', { ascending: true })
    .order('position', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  const turns = (data ?? []) as { advisor_id: string; probabilities: unknown }[];
  if (turns.length === 0) return [];
  const { data: advisors, error: advisorError } = await client
    .from('board_advisors')
    .select('id, key')
    .eq('user_id', userId)
    .in('id', [...new Set(turns.map((t) => t.advisor_id))]);
  if (advisorError) throw new Error(advisorError.message);
  const keys = new Map(((advisors ?? []) as { id: string; key: string }[]).map((a) => [a.id, a.key]));
  return latestForecasts(
    turns.map((t) => ({ advisor: keys.get(t.advisor_id) ?? '', probabilities: t.probabilities })),
  );
}

/** Each advisor on the board, with their track record, for the leaderboard. */
export async function loadTrackRecords(client: YouSupabaseClient, userId: string): Promise<TrackRecord[]> {
  const { data, error } = await client
    .from('board_advisors')
    .select('key, name, believability')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return trackRecords((data ?? []) as { key: string; name: string; believability: unknown }[]);
}
