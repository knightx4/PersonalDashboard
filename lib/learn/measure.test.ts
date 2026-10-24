import { describe, expect, it } from 'vitest';
import type { ExportInput, OutcomeRow } from './ordering-report';
import {
  agreement,
  auc,
  calibration,
  cannotTell,
  completion,
  holdOutByDate,
  logLoss,
  prediction,
  scoredAnswers,
  sessionsPerWeek,
  verdictPairs,
  type Scored,
} from './measure';

const at = (iso: string) => new Date(iso);
const s = (day: number, predicted: number, right: boolean): Scored => ({
  at: at(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`),
  predicted,
  right,
});

const probe = (over: Partial<ExportInput>): ExportInput => ({
  source: 'probe',
  id: 'p',
  shownAt: null,
  answeredAt: at('2026-10-01T10:00:00Z'),
  answerSeconds: null,
  predictedStrength: 0.5,
  confidence: null,
  predictedStatus: null,
  predictedLevel: null,
  outcome: 'right',
  grade: null,
  gradeSecond: null,
  ...over,
});

const cell = (grade: unknown, gradeSecond: unknown): ExportInput => ({
  ...probe({}),
  source: 'cell_question',
  predictedStrength: null,
  outcome: null,
  grade,
  gradeSecond,
});

describe('scored answers', () => {
  it('keeps probes with a prediction and an outcome, Don’t know as not right', () => {
    const rows = scoredAnswers([
      probe({ outcome: 'right' }),
      probe({ outcome: 'dont_know' }),
      probe({ predictedStrength: null }),
      probe({ outcome: null }),
      cell([], null),
    ]);
    expect(rows.map((r) => r.right)).toEqual([true, false]);
  });
});

describe('prediction', () => {
  it('AUC is 1 when every right answer outranks every wrong one, 0.5 on ties, null when one-sided', () => {
    expect(auc([s(1, 0.9, true), s(2, 0.1, false)])).toBe(1);
    expect(auc([s(1, 0.5, true), s(2, 0.5, false)])).toBe(0.5);
    expect(auc([s(1, 0.1, true), s(2, 0.3, false), s(3, 0.5, true)])).toBe(0.5);
    expect(auc([s(1, 0.9, true)])).toBeNull();
    expect(auc([])).toBeNull();
  });

  it('log loss is ln 2 for a coin toss and finite for a certain miss', () => {
    expect(logLoss([s(1, 0.5, true), s(2, 0.5, false)])).toBeCloseTo(Math.log(2));
    expect(logLoss([s(1, 0, true)])).toBeCloseTo(-Math.log(0.001));
    expect(logLoss([])).toBeNull();
  });

  it('holds out the latest answers by date', () => {
    const rows = [s(5, 0.1, true), s(1, 0.2, false), s(3, 0.3, true), s(9, 0.4, false)];
    const { before, held } = holdOutByDate(rows, 0.5);
    expect(before.map((r) => r.predicted)).toEqual([0.2, 0.3]);
    expect(held.map((r) => r.predicted)).toEqual([0.1, 0.4]);
    expect(holdOutByDate([s(1, 0.5, true)]).held).toEqual([]);
    expect(holdOutByDate([s(1, 0.5, true), s(2, 0.5, true)]).held).toHaveLength(1);
  });

  it('sets the baseline from the earlier share right', () => {
    const rows = [s(1, 0.5, true), s(2, 0.5, true), s(3, 0.5, false), s(4, 0.5, true), s(5, 0.9, true), s(6, 0.2, false), s(7, 0.8, true)];
    const p = prediction(rows);
    expect(p).toMatchObject({ answers: 7, before: 5, held: 2, baselineShare: 0.8, auc: 1 });
    expect(p.baselineLogLoss).toBeCloseTo(-(Math.log(0.2) + Math.log(0.8)) / 2);
  });

  it('degrades to nulls with nothing to score', () => {
    expect(prediction([])).toMatchObject({ answers: 0, held: 0, auc: null, logLoss: null, baselineLogLoss: null });
  });
});

describe('calibration', () => {
  it('counts right answers within each band, 1 in the top band', () => {
    const bands = calibration([s(1, 0.05, false), s(2, 0.15, true), s(3, 0.85, true), s(4, 1, true), s(5, 0.4, false)]);
    expect(bands.map((b) => [b.answers, b.right])).toEqual([
      [2, 1],
      [0, 0],
      [1, 0],
      [0, 0],
      [2, 2],
    ]);
    expect(bands[0].meanPredicted).toBeCloseTo(0.1);
    expect(bands[1].meanPredicted).toBeNull();
  });
});

describe('agreement', () => {
  const v = (cellId: string, verdict: string) => ({ cell_id: cellId, verdict, quote: null, reason: null });

  it('pairs verdicts by cell and leaves out a cell only one grader judged', () => {
    expect(verdictPairs([v('a', 'met'), v('b', 'not_met')], [v('b', 'met'), v('c', 'met')])).toEqual([['not_met', 'met']]);
    expect(verdictPairs(null, [v('a', 'met')])).toEqual([]);
  });

  it('works out Cohen’s kappa against chance', () => {
    // 4 pairs: agree on 3. Grader one says met 3 of 4, grader two met 2 of 4.
    const a = agreement([
      cell([v('a', 'met'), v('b', 'met')], [v('a', 'met'), v('b', 'met')]),
      cell([v('c', 'met'), v('d', 'not_met')], [v('c', 'not_met'), v('d', 'not_met')]),
      cell([v('e', 'met')], null),
    ]);
    expect(a).toMatchObject({ answers: 2, pairs: 4, observed: 0.75 });
    expect(a.expected).toBeCloseTo(0.75 * 0.5 + 0.25 * 0.5);
    expect(a.kappa).toBeCloseTo((0.75 - 0.5) / 0.5);
  });

  it('is null with no pairs, or one verdict throughout', () => {
    expect(agreement([]).kappa).toBeNull();
    expect(agreement([cell([v('a', 'met')], [v('a', 'met')])])).toMatchObject({ pairs: 1, observed: 1, kappa: null });
  });
});

describe('sessions per week', () => {
  const view = (iso: string, userId = 'u') => ({ userId, at: at(iso) });

  it('splits on half an hour and counts weeks from the first view', () => {
    const s = sessionsPerWeek(
      [
        view('2026-10-05T10:00:00Z'),
        view('2026-10-05T10:20:00Z'),
        view('2026-10-05T11:00:00Z'),
        view('2026-10-13T09:00:00Z'),
        view('2026-10-05T10:05:00Z', 'other'),
      ],
      at('2026-10-19T10:00:00Z'),
    );
    expect(s).toMatchObject({ views: 5, sessions: 4, weeks: 2, perWeek: 2 });
    expect(s.byWeek).toEqual([
      { monday: '2026-10-05', sessions: 3 },
      { monday: '2026-10-12', sessions: 1 },
      { monday: '2026-10-19', sessions: 0 },
    ]);
  });

  it('counts at least a week and is null with no views', () => {
    expect(sessionsPerWeek([view('2026-10-15T10:00:00Z')], at('2026-10-16T10:00:00Z')).perWeek).toBe(1);
    expect(sessionsPerWeek([], at('2026-10-16T10:00:00Z'))).toMatchObject({ sessions: 0, perWeek: null });
  });
});

describe('completion', () => {
  const o = (kind: string, outcome: string): OutcomeRow => ({ userId: 'u', kind, outcome, at: at('2026-10-01T10:00:00Z') });

  it('compares the rows Learn picked with the readings you queued', () => {
    const c = completion([o('ready', 'answered'), o('recheck', 'not_now'), o('reading', 'read'), o('reading', 'not_now')]);
    expect(c.picked).toMatchObject({ done: 1, notNow: 1, total: 2 });
    expect(c.queued).toMatchObject({ done: 1, notNow: 1, total: 2 });
  });
});

describe('what each number cannot tell', () => {
  it('says so for every number when nothing is recorded', () => {
    const lines = cannotTell({
      prediction: prediction([]),
      bands: calibration([]),
      agreement: agreement([]),
      sessions: sessionsPerWeek([], at('2026-10-16T10:00:00Z')),
      completion: completion([]),
    });
    expect(lines.prediction[0]).toMatch(/No answer has a predicted strength/);
    expect(lines.calibration[0]).toMatch(/No band/);
    expect(lines.agreement[0]).toMatch(/No answer has a second verdict/);
    expect(lines.sessions[0]).toMatch(/No page views/);
    expect(lines.completion[0]).toMatch(/One side is empty/);
  });

  it('names the thin bands and the short hold-out', () => {
    const rows = [s(1, 0.9, true), s(2, 0.1, false), s(3, 0.95, true), s(4, 0.2, true)];
    const lines = cannotTell({
      prediction: prediction(rows),
      bands: calibration(rows),
      agreement: agreement([]),
      sessions: sessionsPerWeek([], at('2026-10-16T10:00:00Z')),
      completion: completion([]),
    });
    expect(lines.prediction.join(' ')).toMatch(/held out: too few/);
    expect(lines.calibration[0]).toMatch(/^0\.0-0\.2, 0\.2-0\.4, 0\.8-1\.0 hold fewer than ten/);
  });
});
