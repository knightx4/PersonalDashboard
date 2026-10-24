import { describe, expect, it } from 'vitest';
import { askedCellMet } from './harness-export';
import {
  confidenceCalibration,
  exportRow,
  followOffers,
  followTracks,
  outcomesByKind,
  outcomesBySittingPlace,
  toCsv,
  verdictText,
  type OutcomeRow,
} from './ordering-report';

const at = (iso: string) => new Date(iso);
const row = (kind: string, outcome: string, iso: string): OutcomeRow => ({
  userId: 'u',
  kind,
  outcome,
  at: at(iso),
});

describe('outcomes', () => {
  it('count by kind', () => {
    const lines = outcomesByKind([
      row('ready', 'answered', '2026-10-01T10:00:00Z'),
      row('ready', 'not_now', '2026-10-01T10:01:00Z'),
      row('reading', 'read', '2026-10-01T10:02:00Z'),
    ]);
    expect(lines.find((l) => l.label === 'ready')).toMatchObject({ answered: 1, notNow: 1, total: 2 });
  });

  it('count by place in a sitting, a long gap starting a new one', () => {
    const lines = outcomesBySittingPlace([
      row('ready', 'answered', '2026-10-01T10:00:00Z'),
      row('ready', 'answered', '2026-10-01T10:10:00Z'),
      row('ready', 'not_now', '2026-10-01T12:00:00Z'),
    ]);
    expect(lines.map((l) => [l.label, l.total])).toEqual([
      ['1st', 2],
      ['2nd', 1],
    ]);
  });
});

describe('following tracks', () => {
  const asOf = at('2026-10-01T00:00:00Z');
  const answered = (subjectId: string, iso: string) => ({
    subjectId,
    shownAt: at(iso),
    answeredAt: at(iso),
  });

  it('weights from before the day and counts answers after it', () => {
    const followed = followTracks(
      [
        answered('a', '2026-09-20T00:00:00Z'),
        answered('a', '2026-09-21T00:00:00Z'),
        answered('b', '2026-09-22T00:00:00Z'),
        answered('a', '2026-10-05T00:00:00Z'),
        answered('a', '2026-12-05T00:00:00Z'),
      ],
      asOf,
    );
    expect(followed[0]).toMatchObject({ subjectId: 'a', weightThen: 3, answeredAfter: 1 });
    expect(followed[1]).toMatchObject({ subjectId: 'b', weightThen: 2, answeredAfter: 0 });
  });

  it('counts a started offer’s answers in the next month and says if the month is over', () => {
    const [offer] = followOffers(
      [{ themeName: 't', themeStrength: 0.4, outcome: 'started', subjectId: 'a', at: at('2026-10-01T00:00:00Z') }],
      [answered('a', '2026-10-05T00:00:00Z')],
      at('2026-10-16T00:00:00Z'),
    );
    expect(offer).toMatchObject({ answeredAfter: 1, complete: false });
  });
});

describe('the export', () => {
  it('reads a probe’s boolean and a cell question’s verdicts', () => {
    expect(verdictText(true)).toBe('right');
    expect(verdictText([{ verdict: 'met' }, { verdict: 'missed' }])).toBe('met|missed');
    expect(verdictText(null)).toBe('');
  });

  it('falls back to the timestamps for seconds and quotes commas', () => {
    const out = exportRow({
      source: 'probe',
      id: 'x',
      shownAt: at('2026-10-01T10:00:00Z'),
      answeredAt: at('2026-10-01T10:00:12Z'),
      answerSeconds: null,
      predictedStrength: 0.5,
      predictedStatus: null,
      predictedLevel: null,
      outcome: 'right',
      grade: null,
      gradeSecond: null,
      confidence: 0.75,
    });
    expect(out.seconds_shown_to_answered).toBe('12');
    expect(out.confidence).toBe('0.75');
    expect(toCsv([{ ...out, id: 'a,b' }])).toContain('"a,b"');
  });
});

describe('calibration by how sure you said you were (plan #2522.3)', () => {
  const row = (confidence: number | null, outcome: string | null, right?: boolean | null) => ({ confidence, outcome, right });

  it('counts answers and right answers at each step', () => {
    const steps = confidenceCalibration([
      row(0.25, 'right'),
      row(0.25, 'wrong'),
      row(0.95, 'right'),
      row(0.95, null, false),
      row(0.75, 'dont_know'),
    ]);
    expect(steps.map((s) => [s.label, s.right, s.answers])).toEqual([
      ['Guessing', 1, 2],
      ['Unsure', 0, 0],
      ['Fairly sure', 0, 1],
      ['Certain', 1, 2],
    ]);
  });

  it('leaves out rows with no confidence or no known result', () => {
    const steps = confidenceCalibration([row(null, 'right'), row(0.5, null)]);
    expect(steps.reduce((n, s) => n + s.answers, 0)).toBe(0);
  });

  it('reads a cell question as right from the met on its asked cell', () => {
    const grade = [
      { cell_id: 'a', verdict: 'met' },
      { cell_id: 'b', verdict: 'not_met' },
    ];
    expect(askedCellMet(grade, 'a')).toBe(true);
    expect(askedCellMet(grade, 'b')).toBe(false);
    expect(askedCellMet(grade, 'c')).toBeNull();
    expect(askedCellMet(null, 'a')).toBeNull();
  });
});
