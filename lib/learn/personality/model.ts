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
  /** A line of the person's own about it (#1633), or null. */
  note: string | null;
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
  'emotional_stability, intellect, typed_value, note, taken_at, created_at, read_points, read_model, read_at';

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
  note: string | null;
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
    note: row.note ?? null,
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

/** The tests a typed-in type can come from, as the compose form offers them. */
export const TYPED_KINDS = [
  { kind: 'mbti', label: 'Myers-Briggs', testName: 'Myers-Briggs', example: 'INTJ' },
  { kind: 'enneagram', label: 'Enneagram', testName: 'Enneagram', example: '5w4' },
  { kind: 'other', label: 'Another test', testName: null, example: 'Analyst' },
] as const satisfies ReadonlyArray<{
  kind: TypedResult['kind'];
  label: string;
  testName: string | null;
  example: string;
}>;

export type TypedKind = TypedResult['kind'];

export type TypedInput = {
  kind: TypedKind;
  testName: string;
  typedValue: string;
  takenAt: string;
  note: string | null;
};

/** What the form sends, before it is checked. */
export type TypedDraft = {
  kind: string;
  testName?: string;
  typedValue: string;
  takenAt: string;
  note?: string;
};

export const TYPED_VALUE_MAX = 60;
export const TEST_NAME_MAX = 120;
export const NOTE_MAX = 500;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** False for a day the calendar does not have, such as 2026-02-30. */
function isRealDay(day: string): boolean {
  const at = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day;
}

/**
 * Check a typed-in type against the table's rules (#1633), or say what is
 * wrong in words the form can show. `today` is the person's own day, so a
 * date after it is refused. The type is kept as written: nothing is scored,
 * matched against a list or changed in case.
 */
export function parseTypedInput(
  draft: TypedDraft,
  today: string,
): { input: TypedInput } | { error: string; field: 'testName' | 'typedValue' | 'takenAt' | 'note' } {
  const choice = TYPED_KINDS.find((k) => k.kind === draft.kind);
  if (!choice) return { error: 'Choose which test it came from.', field: 'testName' };

  const testName = (choice.testName ?? draft.testName ?? '').trim();
  if (!testName) return { error: 'Name the test.', field: 'testName' };
  if (testName.length > TEST_NAME_MAX) {
    return { error: `Keep the test's name under ${TEST_NAME_MAX} characters.`, field: 'testName' };
  }

  const typedValue = draft.typedValue.trim();
  if (!typedValue) return { error: 'Write the result the test gave you.', field: 'typedValue' };
  if (typedValue.length > TYPED_VALUE_MAX) {
    return { error: `Keep the result under ${TYPED_VALUE_MAX} characters.`, field: 'typedValue' };
  }

  const takenAt = draft.takenAt.trim();
  if (!DAY.test(takenAt) || !isRealDay(takenAt)) {
    return { error: 'Give the day you took it.', field: 'takenAt' };
  }
  if (takenAt > today) return { error: 'That day has not come yet.', field: 'takenAt' };

  const note = (draft.note ?? '').trim();
  if (note.length > NOTE_MAX) {
    return { error: `Keep the note under ${NOTE_MAX} characters.`, field: 'note' };
  }

  return { input: { kind: choice.kind, testName, typedValue, takenAt, note: note || null } };
}
