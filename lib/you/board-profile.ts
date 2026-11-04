import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { readBrain, type Brain } from '@/lib/you/board-brain';
import { ROSTER_COLUMNS, rosterOf, type RosterAdvisor } from '@/lib/you/board-advisors';
import { optionsOf, type BoardOption } from '@/lib/you/board-questions';
import { pickOf, reviewsOf, type Outcome } from '@/lib/you/board-reviews';
import { trackRecords, type TrackRecord } from '@/lib/you/board-scoring';
import type { Tab } from '@/lib/tabs';

/**
 * One advisor's profile page (plan #2581.5): who they are and how they think,
 * read from their brain, and their track record: the forecasts scored by
 * topic, and every decision they weighed in on with what they forecast and
 * what happened.
 *
 * A decision an advisor weighed in on is any question they wrote a turn on.
 * Since plan #2581.8 a turn carries a probability per option; an older one
 * carries only scores out of 10, so its forecast is the option they scored
 * highest and no probability.
 */

export type AdvisorDecision = {
  questionId: string;
  /** The meeting that took it up, whose page holds the debate. */
  meetingId: string | null;
  question: string;
  options: BoardOption[];
  /** Their last probability per option that it meets the success measure; null on an older decision. */
  forecast: Record<string, number> | null;
  /** The option they backed: the highest probability, or the highest score on an older decision. */
  pick: string | null;
  /** The option the person chose, once decided. */
  chosen: string | null;
  decidedAt: string | null;
  /** How the person said it went, at the latest check-back they answered. */
  outcome: Outcome | null;
  /** Their Brier score on that answer; null when it scored nothing. */
  brier: number | null;
  askedAt: string;
};

export type AdvisorProfile = {
  advisor: RosterAdvisor;
  brain: Brain | null;
  /** Null until a forecast of theirs is scored. */
  record: TrackRecord | null;
  decisions: AdvisorDecision[];
};

type TurnRow = { question_id: string; probabilities: unknown; scores: unknown };

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function numberMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [letter, v] of Object.entries(value as Record<string, unknown>)) {
    const n = num(v);
    if (n !== null) out[letter] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Every decision an advisor weighed in on, newest asked first. `turns` are
 * theirs, oldest first, so the last one with probabilities (or, failing that,
 * with scores) is their final word.
 */
export function advisorDecisions(
  key: string,
  turns: readonly TurnRow[],
  questions: readonly Record<string, unknown>[],
): AdvisorDecision[] {
  const last = new Map<string, { forecast: Record<string, number> | null; scores: Record<string, number> | null }>();
  for (const turn of turns) {
    const prior = last.get(turn.question_id) ?? { forecast: null, scores: null };
    const forecast = numberMap(turn.probabilities);
    const scores = numberMap(turn.scores);
    last.set(turn.question_id, { forecast: forecast ?? prior.forecast, scores: scores ?? prior.scores });
  }
  return questions
    .flatMap((row): AdvisorDecision[] => {
      if (typeof row.id !== 'string' || !last.has(row.id)) return [];
      const { forecast, scores } = last.get(row.id)!;
      const answered = reviewsOf(row.reviews).filter((r) => r.outcome !== null);
      const latest = answered[answered.length - 1] ?? null;
      const score = latest?.scores.find((s) => s.advisor === key) ?? null;
      const decided = row.status === 'decided' || typeof row.decided_option === 'string';
      return [
        {
          questionId: row.id,
          meetingId: typeof row.meeting_id === 'string' ? row.meeting_id : null,
          question: typeof row.question === 'string' ? row.question.trim() : '',
          options: optionsOf(row.options),
          forecast,
          pick: pickOf(forecast ?? scores),
          chosen: decided && typeof row.decided_option === 'string' ? row.decided_option : null,
          decidedAt: typeof row.decided_at === 'string' ? row.decided_at : null,
          outcome: latest?.outcome ?? null,
          brier: score?.brier ?? null,
          askedAt: typeof row.created_at === 'string' ? row.created_at : '',
        },
      ];
    })
    .sort((a, b) => b.askedAt.localeCompare(a.askedAt));
}

/**
 * A mean Brier score in words: 0 is a perfect forecast and 0.25 what a coin
 * toss scores, so under 0.1 is usually right and 0.25 or more no better than
 * guessing.
 */
export function brierWords(brier: number): string {
  if (brier <= 0.1) return 'usually right';
  if (brier <= 0.18) return 'more right than wrong';
  if (brier < 0.25) return 'a little better than a coin toss';
  return 'no better than a coin toss';
}

/** "12 scored · usually right", or that none is scored yet. */
export function recordLine(record: TrackRecord | null): string {
  if (!record) return 'No forecasts scored yet';
  return `${record.scored} scored · ${brierWords(record.brier)}`;
}

/** "62%", for a probability from 0 to 1. */
export function percent(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** One advisor's profile by key, or null when they are not on the person's board. */
export async function loadAdvisorProfile(
  client: YouSupabaseClient,
  userId: string,
  key: string,
): Promise<AdvisorProfile | null> {
  const { data, error } = await client
    .from('board_advisors')
    .select(`${ROSTER_COLUMNS}, believability`)
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const advisor = rosterOf(row);
  if (!advisor) return null;

  const { data: turns, error: turnError } = await client
    .from('board_turns')
    .select('question_id, probabilities, scores, created_at, position')
    .eq('user_id', userId)
    .eq('advisor_id', advisor.id)
    .order('created_at', { ascending: true })
    .order('position', { ascending: true })
    .limit(2000);
  if (turnError) throw new Error(turnError.message);
  const turnRows = (turns ?? []) as TurnRow[];
  const ids = [...new Set(turnRows.map((t) => t.question_id))];
  let questions: Record<string, unknown>[] = [];
  if (ids.length > 0) {
    const { data: rows, error: questionError } = await client
      .from('board_questions')
      .select('id, meeting_id, question, options, status, decided_option, decided_at, reviews, created_at')
      .eq('user_id', userId)
      .in('id', ids);
    if (questionError) throw new Error(questionError.message);
    questions = (rows ?? []) as Record<string, unknown>[];
  }

  return {
    advisor,
    brain: readBrain(row.brain),
    record: trackRecords([{ key: advisor.key, name: advisor.name, believability: row.believability }])[0] ?? null,
    decisions: advisorDecisions(advisor.key, turnRows, questions),
  };
}

/** Each advisor's track record by key, for the roster's cards. */
export function recordsByKey(records: readonly TrackRecord[]): Record<string, TrackRecord> {
  return Object.fromEntries(records.map((r) => [r.advisor, r]));
}

/** The profile's tabs; About is the plain address. Talk is the one-on-one chat (plan #2581.6). */
export const ADVISOR_TABS = [
  { id: 'about', label: 'About' },
  { id: 'talk', label: 'Talk' },
  { id: 'record', label: 'Track record' },
  { id: 'sources', label: 'Sources' },
] as const satisfies readonly Tab[];

export type AdvisorTab = (typeof ADVISOR_TABS)[number]['id'];

/** Where an advisor's profile lives. */
export function advisorHref(key: string, tab?: AdvisorTab): string {
  const base = `/you/council/advisors/${encodeURIComponent(key)}`;
  return tab && tab !== 'about' ? `${base}?tab=${tab}` : base;
}
