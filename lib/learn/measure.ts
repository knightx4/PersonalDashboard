import { SITTING_GAP_MINUTES, type ExportInput, type OutcomeRow } from '@/lib/learn/ordering-report';

/**
 * The arithmetic behind scripts/learn-measure.ts (plan #2179.2): five numbers
 * on whether Learn knows what you know, each with the count behind it.
 *
 * Everything here takes rows and returns numbers. A number that cannot be
 * worked out from the rows given (no answers, or answers all one way) comes
 * back as null rather than as a zero that reads like a result.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** One answer Learn had a belief about: the strength it predicted and whether you got it right. */
export type Scored = { at: Date; predicted: number; right: boolean };

/**
 * The probes with a predicted strength and an outcome. Don't know counts as
 * not right: Learn predicted you would know it, and you said you did not.
 */
export function scoredAnswers(rows: readonly ExportInput[]): Scored[] {
  return rows.flatMap((r) =>
    r.source === 'probe' && r.predictedStrength !== null && r.outcome !== null && r.answeredAt
      ? [{ at: r.answeredAt, predicted: r.predictedStrength, right: r.outcome === 'right' }]
      : [],
  );
}

/** The share of answers held out at the end, by date. */
export const HELD_OUT_SHARE = 0.3;

/**
 * Splits answers by date: the latest share are held out, the rest come before.
 * With two or more answers at least one is held out and at least one kept.
 */
export function holdOutByDate(rows: readonly Scored[], share = HELD_OUT_SHARE) {
  const sorted = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (sorted.length < 2) return { before: sorted, held: [] as Scored[] };
  const held = Math.min(sorted.length - 1, Math.max(1, Math.round(sorted.length * share)));
  return { before: sorted.slice(0, sorted.length - held), held: sorted.slice(sorted.length - held) };
}

/**
 * Area under the ROC curve: the chance a right answer was given a higher
 * predicted strength than a wrong one, ties counting half. Null without at
 * least one of each.
 */
export function auc(rows: readonly Scored[]): number | null {
  const right = rows.filter((r) => r.right).map((r) => r.predicted);
  const wrong = rows.filter((r) => !r.right).map((r) => r.predicted);
  if (right.length === 0 || wrong.length === 0) return null;
  let wins = 0;
  for (const r of right) for (const w of wrong) wins += r > w ? 1 : r === w ? 0.5 : 0;
  return wins / (right.length * wrong.length);
}

/** Predictions are clamped this far from 0 and 1, so one certain miss cannot make the loss infinite. */
export const LOSS_CLAMP = 0.001;

/** Mean log loss in nats, lower is better; null with no answers. */
export function logLoss(rows: readonly Scored[], predict: (r: Scored) => number = (r) => r.predicted): number | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => {
    const p = Math.min(1 - LOSS_CLAMP, Math.max(LOSS_CLAMP, predict(r)));
    return sum - Math.log(r.right ? p : 1 - p);
  }, 0);
  return total / rows.length;
}

export type Prediction = {
  /** Answers with a predicted strength and an outcome. */
  answers: number;
  before: number;
  held: number;
  /** The first held-out answer's date. */
  heldFrom: Date | null;
  auc: number | null;
  logLoss: number | null;
  /** The log loss of always predicting the share right among the earlier answers. */
  baselineLogLoss: number | null;
  baselineShare: number | null;
};

/**
 * Next-answer prediction over the held-out answers. The strength score is not
 * fitted to anything, so the earlier answers serve only to set the baseline it
 * has to beat: guessing the share you got right before.
 */
export function prediction(rows: readonly Scored[]): Prediction {
  const { before, held } = holdOutByDate(rows);
  const baselineShare = before.length === 0 ? null : before.filter((r) => r.right).length / before.length;
  return {
    answers: rows.length,
    before: before.length,
    held: held.length,
    heldFrom: held[0]?.at ?? null,
    auc: auc(held),
    logLoss: logLoss(held),
    baselineLogLoss: baselineShare === null ? null : logLoss(held, () => baselineShare),
    baselineShare,
  };
}

export type Band = { label: string; from: number; to: number; answers: number; right: number; meanPredicted: number | null };

/** Five bands of predicted strength, the last closed at 1. */
export const BAND_EDGES = [0, 0.2, 0.4, 0.6, 0.8, 1];

/**
 * Calibration: within each band of predicted strength, the share you got
 * right. A calibrated score has each band's share near its mean prediction.
 */
export function calibration(rows: readonly Scored[]): Band[] {
  const bands: Band[] = BAND_EDGES.slice(0, -1).map((from, i) => ({
    label: `${from.toFixed(1)}-${BAND_EDGES[i + 1].toFixed(1)}`,
    from,
    to: BAND_EDGES[i + 1],
    answers: 0,
    right: 0,
    meanPredicted: null,
  }));
  const sums = bands.map(() => 0);
  for (const r of rows) {
    const p = Math.min(1, Math.max(0, r.predicted));
    const found = bands.findIndex((b) => p < b.to);
    const i = found === -1 ? bands.length - 1 : found;
    bands[i].answers += 1;
    if (r.right) bands[i].right += 1;
    sums[i] += p;
  }
  return bands.map((b, i) => ({ ...b, meanPredicted: b.answers === 0 ? null : sums[i] / b.answers }));
}

/**
 * The verdicts two graders gave the same cells on one answer, paired by cell.
 * A cell only one grader judged is left out, since agreement needs both.
 */
export function verdictPairs(first: unknown, second: unknown): [string, string][] {
  const byCell = (grade: unknown) => {
    const map = new Map<string, string>();
    if (!Array.isArray(grade)) return map;
    for (const g of grade) {
      if (g && typeof g === 'object' && 'cell_id' in g && 'verdict' in g) {
        map.set(String((g as { cell_id: unknown }).cell_id), String((g as { verdict: unknown }).verdict));
      }
    }
    return map;
  };
  const a = byCell(first);
  const b = byCell(second);
  return [...a].flatMap(([cell, verdict]) => (b.has(cell) ? [[verdict, b.get(cell)!] as [string, string]] : []));
}

export type Agreement = {
  /** Answers with a second grader's verdict. */
  answers: number;
  /** Cells both graders judged. */
  pairs: number;
  observed: number | null;
  expected: number | null;
  kappa: number | null;
  /** The rough standard error of kappa, from the observed and chance agreement. */
  standardError: number | null;
};

/**
 * Cohen's kappa over the paired verdicts: agreement beyond what the two
 * graders' own rates of each verdict would give by chance. Null with no pairs,
 * or when both graders gave one verdict throughout, where chance explains all
 * of it and the formula divides by zero.
 */
export function agreement(rows: readonly ExportInput[]): Agreement {
  const graded = rows.filter((r) => r.source === 'cell_question' && Array.isArray(r.gradeSecond));
  const pairs = graded.flatMap((r) => verdictPairs(r.grade, r.gradeSecond));
  if (pairs.length === 0) return { answers: graded.length, pairs: 0, observed: null, expected: null, kappa: null, standardError: null };
  const n = pairs.length;
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  const labels = new Set(pairs.flat());
  let expected = 0;
  for (const label of labels) {
    expected += (pairs.filter(([a]) => a === label).length / n) * (pairs.filter(([, b]) => b === label).length / n);
  }
  const kappa = expected >= 1 ? null : (observed - expected) / (1 - expected);
  const standardError = expected >= 1 ? null : Math.sqrt((observed * (1 - observed)) / (n * (1 - expected) ** 2));
  return { answers: graded.length, pairs: n, observed, expected, kappa, standardError };
}

export type PageView = { userId: string; at: Date };

export type Sessions = {
  views: number;
  sessions: number;
  /** Weeks from the first view to now, at least one. */
  weeks: number;
  perWeek: number | null;
  first: Date | null;
  /** Sessions in each week, Monday first, oldest first. */
  byWeek: { monday: string; sessions: number }[];
};

function mondayOf(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Sessions per week: views split where more than half an hour passes, the
 * same gap that starts a new sitting in the ordering report, counted from
 * the first view to `now`.
 */
export function sessionsPerWeek(views: readonly PageView[], now: Date): Sessions {
  const byUser = new Map<string, number[]>();
  for (const v of views) byUser.set(v.userId, [...(byUser.get(v.userId) ?? []), v.at.getTime()]);
  const starts: number[] = [];
  for (const times of byUser.values()) {
    times.sort((a, b) => a - b);
    times.forEach((t, i) => {
      if (i === 0 || t - times[i - 1] > SITTING_GAP_MINUTES * 60_000) starts.push(t);
    });
  }
  if (starts.length === 0) return { views: 0, sessions: 0, weeks: 0, perWeek: null, first: null, byWeek: [] };
  const first = Math.min(...starts);
  const weeks = Math.max(1, (now.getTime() - first) / (7 * DAY_MS));
  const counts = new Map<string, number>();
  for (const s of starts) {
    const monday = mondayOf(new Date(s));
    counts.set(monday, (counts.get(monday) ?? 0) + 1);
  }
  const byWeek: Sessions['byWeek'] = [];
  for (let m = new Date(mondayOf(new Date(first))); m.getTime() <= now.getTime(); m = new Date(m.getTime() + 7 * DAY_MS)) {
    const monday = m.toISOString().slice(0, 10);
    byWeek.push({ monday, sessions: counts.get(monday) ?? 0 });
  }
  return { views: views.length, sessions: starts.length, weeks, perWeek: starts.length / weeks, first: new Date(first), byWeek };
}

export type Completion = { label: string; done: number; notNow: number; total: number };

/**
 * Completion of the rows Learn picked against the rest, from what you did
 * with each. A question offered as ready to start or due a re-check is one
 * Learn chose; a reading is one you put on the queue yourself. Done is an
 * answer or a read; the only recorded alternative is Not now.
 */
export function completion(rows: readonly OutcomeRow[]): { picked: Completion; queued: Completion } {
  const count = (label: string, kinds: string[]): Completion => {
    const own = rows.filter((r) => kinds.includes(r.kind));
    const notNow = own.filter((r) => r.outcome === 'not_now').length;
    return { label, done: own.length - notNow, notNow, total: own.length };
  };
  return {
    picked: count('picked by Learn (ready, re-check)', ['ready', 'recheck']),
    queued: count('queued by you (reading)', ['reading']),
  };
}

/** Under this many, a number is printed with the warning that one more answer can move it a long way. */
export const FIRM_AT = 100;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What each number cannot tell at the count it was worked from. */
export function cannotTell(input: {
  prediction: Prediction;
  bands: readonly Band[];
  agreement: Agreement;
  sessions: Sessions;
  completion: { picked: Completion; queued: Completion };
}): Record<'prediction' | 'calibration' | 'agreement' | 'sessions' | 'completion', string[]> {
  const p = input.prediction;
  const lines = {
    prediction: [] as string[],
    calibration: [] as string[],
    agreement: [] as string[],
    sessions: [] as string[],
    completion: [] as string[],
  };

  if (p.answers === 0) {
    lines.prediction.push('No answer has a predicted strength yet: it is recorded from #2179.1 on, so every answer before that has nothing to check against.');
  } else {
    if (p.auc === null) lines.prediction.push('AUC needs at least one right and one wrong answer among those held out.');
    if (p.held < FIRM_AT) {
      lines.prediction.push(
        `Only ${plural(p.held, 'answer')} held out: too few to rank the score against the baseline. The feature reads these numbers at ${FIRM_AT}.`,
      );
    }
  }
  lines.prediction.push('Both numbers say how well the score ranks and prices answers you gave. They say nothing about ideas Learn never asked about.');

  const thin = input.bands.filter((b) => b.answers > 0 && b.answers < 10);
  if (input.bands.every((b) => b.answers === 0)) {
    lines.calibration.push('No band has an answer in it yet.');
  } else if (thin.length > 0) {
    lines.calibration.push(
      `${thin.map((b) => b.label).join(', ')} ${thin.length === 1 ? 'holds' : 'hold'} fewer than ten answers, where one answer moves the share by ten points or more.`,
    );
  }
  lines.calibration.push('Each band shows the score against your answers in that band only. A band with no answers says nothing about the score there.');

  const a = input.agreement;
  if (a.pairs === 0) {
    lines.agreement.push(
      a.answers === 0
        ? 'No answer has a second verdict yet. The second grader runs on written answers to cell questions (#2138.12), and none has been graded.'
        : 'The answers with a second verdict share no cell with the first, so there is nothing to pair.',
    );
  } else {
    if (a.kappa === null) lines.agreement.push('Both graders gave one verdict throughout, so agreement cannot be told from chance.');
    if (a.pairs < 30) {
      lines.agreement.push(`Only ${plural(a.pairs, 'paired verdict')}: too few for kappa to separate fair agreement from good; the margin printed beside it says by how much.`);
    }
  }
  lines.agreement.push('Two models agreeing is not the same as either being right; only a verdict of yours would check that.');

  const s = input.sessions;
  if (s.sessions === 0) {
    lines.sessions.push('No page views are recorded in this range.');
  } else {
    lines.sessions.push(
      `Page views start on ${s.first!.toISOString().slice(0, 10)}, ${plural(Math.floor(s.weeks), 'full week')} ago, which is too short to tell a habit from a run of use.`,
    );
  }
  lines.sessions.push('A page left open counts once, and a visit that loads no new page leaves no trace.');

  const c = input.completion;
  if (c.picked.total === 0 || c.queued.total === 0) {
    lines.completion.push(
      `One side is empty (${c.picked.total} picked, ${c.queued.total} queued), so the two cannot be compared.`,
    );
  }
  if (c.picked.notNow + c.queued.notNow === 0) {
    lines.completion.push('No Not now is recorded, so every row acted on reads as completed.');
  }
  lines.completion.push('Showing a row is not recorded, so this is completion of rows you acted on, not of rows offered.');
  return lines;
}
