import { BIG_FIVE_FACTORS, type BigFiveScores } from './ipip';

/**
 * A personality result as the app reads it (plan #1632), from a row of
 * `learn.personality_results` (plan #1631).
 *
 * A Big Five result carries its scores and answers; any other kind carries
 * the type as it was typed in (#1633). Dash's read (#1635) rides on either.
 */

export type PersonalityKind = 'big_five' | 'mbti' | 'enneagram' | 'other';

type Common = {
  id: string;
  testName: string;
  /** The day it was taken, `YYYY-MM-DD`. */
  takenAt: string;
  createdAt: string;
  read: { points: unknown[]; model: string; at: string } | null;
};

export type BigFiveResult = Common & {
  kind: 'big_five';
  scores: BigFiveScores;
  answers: number[];
};

export type TypedResult = Common & {
  kind: Exclude<PersonalityKind, 'big_five'>;
  typedValue: string;
};

export type PersonalityResult = BigFiveResult | TypedResult;

/** The columns a load selects, in the order `fromRow` reads them. */
export const RESULT_COLUMNS =
  'id, kind, test_name, answers, extraversion, agreeableness, conscientiousness, ' +
  'emotional_stability, intellect, typed_value, taken_at, created_at, read_points, read_model, read_at';

export type ResultRow = {
  id: string;
  kind: string;
  test_name: string;
  answers: unknown;
  extraversion: number | null;
  agreeableness: number | null;
  conscientiousness: number | null;
  emotional_stability: number | null;
  intellect: number | null;
  typed_value: string | null;
  taken_at: string;
  created_at: string;
  read_points: unknown;
  read_model: string | null;
  read_at: string | null;
};

/** A row as a result, or null for one whose shape the database should have refused. */
export function fromRow(row: ResultRow): PersonalityResult | null {
  const read =
    Array.isArray(row.read_points) && row.read_model && row.read_at
      ? { points: row.read_points as unknown[], model: row.read_model, at: row.read_at }
      : null;
  const common = {
    id: row.id,
    testName: row.test_name,
    takenAt: row.taken_at,
    createdAt: row.created_at,
    read,
  };

  if (row.kind === 'big_five') {
    const scores = {} as BigFiveScores;
    for (const factor of BIG_FIVE_FACTORS) {
      const value = row[factor];
      if (typeof value !== 'number') return null;
      scores[factor] = value;
    }
    const answers = Array.isArray(row.answers) ? (row.answers as number[]) : [];
    return { ...common, kind: 'big_five', scores, answers };
  }

  if (row.kind === 'mbti' || row.kind === 'enneagram' || row.kind === 'other') {
    if (!row.typed_value) return null;
    return { ...common, kind: row.kind, typedValue: row.typed_value };
  }
  return null;
}

/** The newest Big Five result, by the day taken and then by when it was saved. */
export function latestBigFive(results: readonly PersonalityResult[]): BigFiveResult | null {
  return (
    results
      .filter((r): r is BigFiveResult => r.kind === 'big_five')
      .sort(
        (a, b) =>
          b.takenAt.localeCompare(a.takenAt) || b.createdAt.localeCompare(a.createdAt),
      )[0] ?? null
  );
}
