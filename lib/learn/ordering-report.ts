import { trackWeights, INTEREST_WINDOW_DAYS, type TrackActivity } from '@/lib/learn/flow/interest';
import { CONFIDENCE, confidenceWords } from '@/lib/learn/confidence';

/**
 * The reading behind scripts/learn-ordering-report.ts (plan #2154.1).
 *
 * Everything here takes rows and returns numbers, so the script holds only the
 * queries and the printing. The questions it answers are whether the order
 * Learn offers things in matches what you then do, and whether the tracks the
 * flow weights up are the ones you keep answering.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const FOLLOW_DAYS = 30;

/** A gap longer than this between two outcomes starts a new sitting. */
export const SITTING_GAP_MINUTES = 30;

export type OutcomeRow = { userId: string; kind: string; outcome: string; at: Date };

export type OutcomeLine = { label: string; answered: number; read: number; notNow: number; total: number };

function tally(lines: Map<string, OutcomeLine>, label: string, outcome: string) {
  const line = lines.get(label) ?? { label, answered: 0, read: 0, notNow: 0, total: 0 };
  if (outcome === 'answered') line.answered += 1;
  else if (outcome === 'read') line.read += 1;
  else line.notNow += 1;
  line.total += 1;
  lines.set(label, line);
}

/** Outcomes counted by the kind of row they were on. */
export function outcomesByKind(rows: readonly OutcomeRow[]): OutcomeLine[] {
  const lines = new Map<string, OutcomeLine>();
  for (const row of rows) tally(lines, row.kind, row.outcome);
  return [...lines.values()].sort((a, b) => b.total - a.total);
}

const PLACES = ['1st', '2nd', '3rd', '4th or later'];

/**
 * Outcomes counted by how far into a sitting they came: the first, second,
 * third, and fourth or later thing you did before a gap of half an hour.
 *
 * This is a stand-in. The position a row was offered at is not stored, so what
 * is counted is the order you acted in, which the offered order shapes but is
 * not.
 */
export function outcomesBySittingPlace(rows: readonly OutcomeRow[]): OutcomeLine[] {
  const byUser = new Map<string, OutcomeRow[]>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);

  const lines = new Map<string, OutcomeLine>();
  for (const own of byUser.values()) {
    own.sort((a, b) => a.at.getTime() - b.at.getTime());
    let place = 0;
    let last: number | null = null;
    for (const row of own) {
      const at = row.at.getTime();
      place = last !== null && at - last <= SITTING_GAP_MINUTES * 60_000 ? place + 1 : 1;
      last = at;
      tally(lines, PLACES[Math.min(place, 4) - 1], row.outcome);
    }
  }
  return PLACES.flatMap((p) => lines.get(p) ?? []);
}

/** A question in a track, shown and possibly answered. */
export type ProbeEvent = {
  subjectId: string;
  shownAt: Date | null;
  answeredAt: Date | null;
};

export type TrackFollow = {
  subjectId: string;
  /** The weight the flow would have given it on the day, from the four weeks before. */
  weightThen: number;
  /** Questions answered in the 30 days after that day. */
  answeredAfter: number;
};

/**
 * What each track weighed on `asOf` and how many questions you answered in it
 * in the 30 days after.
 *
 * The weight is the one lib/learn/flow/interest.ts gives, worked from the
 * questions alone: lessons swiped in Learn now and ideas pushed aside are not
 * counted, so a weight here can differ a little from the one the flow used.
 */
export function followTracks(events: readonly ProbeEvent[], asOf: Date): TrackFollow[] {
  const end = asOf.getTime();
  const windowStart = end - INTEREST_WINDOW_DAYS * DAY_MS;
  const before = events.filter(
    (e) => (e.answeredAt?.getTime() ?? e.shownAt?.getTime() ?? Infinity) < end,
  );

  const lastShown = before.reduce<number | null>((latest, e) => {
    const t = e.shownAt?.getTime() ?? null;
    return t !== null && (latest === null || t > latest) ? t : latest;
  }, null);

  const activity = new Map<string, TrackActivity>();
  for (const e of before) {
    const track = activity.get(e.subjectId) ?? { answered: 0, skipped: 0, pushedAside: 0, answeredBefore: 0 };
    const answered = e.answeredAt?.getTime() ?? null;
    const shown = e.shownAt?.getTime() ?? null;
    if (answered !== null) {
      if (answered >= windowStart) track.answered += 1;
      else track.answeredBefore += 1;
    } else if (shown !== null && shown >= windowStart && shown !== lastShown) {
      track.skipped += 1;
    }
    activity.set(e.subjectId, track);
  }
  const weights = trackWeights(activity);

  const after = new Map<string, number>();
  for (const e of events) {
    const t = e.answeredAt?.getTime();
    if (t !== undefined && t >= end && t < end + FOLLOW_DAYS * DAY_MS) {
      after.set(e.subjectId, (after.get(e.subjectId) ?? 0) + 1);
    }
  }
  return [...activity.keys()]
    .map((subjectId) => ({
      subjectId,
      weightThen: weights.get(subjectId)?.weight ?? 1,
      answeredAfter: after.get(subjectId) ?? 0,
    }))
    .sort((a, b) => b.weightThen - a.weightThen);
}

export type OfferRow = {
  themeName: string;
  themeStrength: number | null;
  outcome: string;
  subjectId: string | null;
  at: Date;
};

export type OfferFollow = OfferRow & {
  /** Questions answered in the track in the 30 days after the offer; null when it was not started. */
  answeredAfter: number | null;
  /** Whether the 30 days have passed. */
  complete: boolean;
};

/** Each track offer, and for a started one the questions answered in the month after. */
export function followOffers(
  offers: readonly OfferRow[],
  events: readonly ProbeEvent[],
  now: Date,
): OfferFollow[] {
  return offers.map((offer) => {
    const start = offer.at.getTime();
    const answeredAfter =
      offer.outcome === 'started' && offer.subjectId
        ? events.filter((e) => {
            const t = e.answeredAt?.getTime();
            return (
              e.subjectId === offer.subjectId && t !== undefined && t >= start && t < start + FOLLOW_DAYS * DAY_MS
            );
          }).length
        : null;
    return { ...offer, answeredAfter, complete: now.getTime() >= start + FOLLOW_DAYS * DAY_MS };
  });
}

export type ExportInput = {
  source: 'probe' | 'cell_question';
  id: string;
  shownAt: Date | null;
  answeredAt: Date | null;
  answerSeconds: number | null;
  predictedStrength: number | null;
  predictedStatus: string | null;
  predictedLevel: number | null;
  outcome: string | null;
  /** The first grader's verdicts: a probe's response_correct, or a cell question's grade. */
  grade: unknown;
  gradeSecond: unknown;
  /** How sure they said they were, 0 to 1; null when not asked or not given (plan #2522.3). */
  confidence: number | null;
  /**
   * Whether the answer was right: a probe's outcome, or a met on the asked
   * cell for a cell question. Null when it cannot be told (plan #2522.3).
   */
  right?: boolean | null;
};

export type ExportRow = {
  source: string;
  id: string;
  shown_at: string;
  answered_at: string;
  seconds_shown_to_answered: string;
  predicted_strength: string;
  predicted_status: string;
  predicted_level: string;
  outcome: string;
  confidence: string;
  grader_1: string;
  grader_2: string;
};

/** A grade as one cell: its verdicts in order, joined by a bar. */
export function verdictText(grade: unknown): string {
  if (grade === null || grade === undefined) return '';
  if (typeof grade === 'boolean') return grade ? 'right' : 'wrong';
  if (!Array.isArray(grade)) return '';
  return grade
    .map((g) => (g && typeof g === 'object' && 'verdict' in g ? String((g as { verdict: unknown }).verdict) : ''))
    .filter(Boolean)
    .join('|');
}

/**
 * Seconds from shown to answered. The stored answer_seconds wins; a row from
 * before it was kept falls back to the two timestamps.
 */
export function secondsOf(row: Pick<ExportInput, 'answerSeconds' | 'shownAt' | 'answeredAt'>): number | null {
  if (row.answerSeconds !== null) return row.answerSeconds;
  if (!row.shownAt || !row.answeredAt) return null;
  const seconds = (row.answeredAt.getTime() - row.shownAt.getTime()) / 1000;
  return seconds >= 0 ? Math.round(seconds * 10) / 10 : null;
}

const cell = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/** One row per graded answer, as text ready for a file. */
export function exportRow(row: ExportInput): ExportRow {
  return {
    source: row.source,
    id: row.id,
    shown_at: row.shownAt?.toISOString() ?? '',
    answered_at: row.answeredAt?.toISOString() ?? '',
    seconds_shown_to_answered: cell(secondsOf(row)),
    predicted_strength: cell(row.predictedStrength),
    predicted_status: cell(row.predictedStatus),
    predicted_level: cell(row.predictedLevel),
    outcome: cell(row.outcome),
    confidence: cell(row.confidence),
    grader_1: verdictText(row.grade),
    grader_2: verdictText(row.gradeSecond),
  };
}

const EXPORT_COLUMNS: (keyof ExportRow)[] = [
  'source',
  'id',
  'shown_at',
  'answered_at',
  'seconds_shown_to_answered',
  'predicted_strength',
  'predicted_status',
  'predicted_level',
  'outcome',
  'confidence',
  'grader_1',
  'grader_2',
];

/** Whether an exported answer was right: its `right`, else its outcome. Null when neither tells. */
export function wasRight(row: Pick<ExportInput, 'right' | 'outcome'>): boolean | null {
  if (typeof row.right === 'boolean') return row.right;
  if (row.outcome === 'right') return true;
  if (row.outcome === 'wrong' || row.outcome === 'dont_know') return false;
  return null;
}

/** One confidence step as answered: how many, and how many right. */
export type ConfidenceStep = { label: string; confidence: number; answers: number; right: number };

/**
 * Calibration by stated confidence (plan #2522.3): for each of the four
 * steps, how many answers gave it and how many of those were right. A
 * well-calibrated person is right about as often as they said they would be:
 * a quarter of guesses, nearly all of Certain. Rows with no confidence or no
 * known result are left out; steps nobody used are kept, at zero.
 */
export function confidenceCalibration(rows: readonly Pick<ExportInput, 'confidence' | 'right' | 'outcome'>[]): ConfidenceStep[] {
  const steps: ConfidenceStep[] = [
    { label: 'Guessing', confidence: CONFIDENCE.guessing, answers: 0, right: 0 },
    { label: 'Unsure', confidence: CONFIDENCE.unsure, answers: 0, right: 0 },
    { label: 'Fairly sure', confidence: CONFIDENCE.fairlySure, answers: 0, right: 0 },
    { label: 'Certain', confidence: CONFIDENCE.certain, answers: 0, right: 0 },
  ];
  for (const row of rows) {
    if (row.confidence === null) continue;
    const right = wasRight(row);
    if (right === null) continue;
    const step = steps.find((s) => s.label === confidenceWords(row.confidence as number));
    if (!step) continue;
    step.answers += 1;
    if (right) step.right += 1;
  }
  return steps;
}

/** Comma-separated text with a header line; fields with commas, quotes or newlines are quoted. */
export function toCsv(rows: readonly ExportRow[]): string {
  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = rows.map((r) => EXPORT_COLUMNS.map((key) => quote(r[key])).join(','));
  return [EXPORT_COLUMNS.join(','), ...lines].join('\n') + '\n';
}

/** What the record cannot tell, said at the foot of the report. */
export const CANNOT_TELL: readonly string[] = [
  'Showing a row is not recorded. A row you never reached cannot be told from one you saw and skipped, so the shares above are shares of what you did, not of what was offered.',
  'The position a row was offered at is not recorded. The sitting place above is the order you acted in, which the offered order shapes but does not equal.',
  'A Not now is the only recorded refusal. Leaving a row alone leaves no trace.',
  'A track offer records a press. An offer shown and ignored leaves nothing, and nothing records the weight the flow gave a track on a given day, so the weights above are worked back from the questions.',
  'With a few dozen rows, a difference between two groups is as likely to be chance as a signal. Months of use are what make these numbers firm.',
  'The idea this came from answers a record that says nothing by asking you outright which tracks you want weighted up.',
];
