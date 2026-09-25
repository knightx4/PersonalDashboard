import { describe, expect, it } from 'vitest';
import {
  formatReading,
  movementLine,
  numberFromChoices,
  parseMeasureFields,
  parseNumber,
  parseNumberFrom,
  parseReadingFields,
  projectTarget,
  projectionLine,
  readingChart,
  spanWords,
  sortReadings,
  type Reading,
} from './readings';

const form = (fields: Record<string, string>) => (key: string) => fields[key] ?? null;

function reading(id: string, readOn: string, value: number): Reading {
  return { id, value, readOn, note: null, captureId: null };
}

const day = (iso: string) => iso;

describe('parseNumber', () => {
  it('reads a number as people type it', () => {
    expect(parseNumber('18,250.40')).toBe(18250.4);
    expect(parseNumber('$18,250')).toBe(18250);
    expect(parseNumber(' 182.5 ')).toBe(182.5);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber(42)).toBe(42);
  });

  it('refuses anything else rather than guessing', () => {
    expect(parseNumber('about 200')).toBeNull();
    expect(parseNumber('200lb')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(Number.NaN)).toBeNull();
    expect(parseNumber('1e30')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
});

describe('parseMeasureFields', () => {
  it('takes a unit and an optional target', () => {
    expect(parseMeasureFields(form({ unit: ' $ ', target: '0' }))).toEqual({
      ok: true,
      value: { unit: '$', target: 0 },
    });
    expect(parseMeasureFields(form({ unit: 'lb', target: '' }))).toEqual({
      ok: true,
      value: { unit: 'lb', target: null },
    });
  });

  it('clears the target with the unit', () => {
    expect(parseMeasureFields(form({ unit: '', target: '225' }))).toEqual({
      ok: true,
      value: { unit: null, target: null },
    });
  });

  it('refuses a target that is not a number and an overlong unit', () => {
    expect(parseMeasureFields(form({ unit: 'lb', target: 'lots' })).ok).toBe(false);
    expect(parseMeasureFields(form({ unit: 'x'.repeat(41) })).ok).toBe(false);
  });
});

describe('parseReadingFields', () => {
  const today = '2026-09-24';

  it('takes a value, a day that defaults to today, and a note', () => {
    expect(parseReadingFields(form({ value: '4,200' }), today)).toEqual({
      ok: true,
      value: { value: 4200, readOn: today, note: null },
    });
    expect(
      parseReadingFields(form({ value: '185', readOn: '2026-09-01', note: ' after the holiday ' }), today),
    ).toEqual({ ok: true, value: { value: 185, readOn: '2026-09-01', note: 'after the holiday' } });
  });

  it('refuses no number, a bad date and a day still to come', () => {
    expect(parseReadingFields(form({}), today).ok).toBe(false);
    expect(parseReadingFields(form({ value: 'x' }), today).ok).toBe(false);
    expect(parseReadingFields(form({ value: '1', readOn: 'soon' }), today).ok).toBe(false);
    expect(parseReadingFields(form({ value: '1', readOn: '2026-09-25' }), today)).toEqual({
      ok: false,
      error: 'Pick a day that has already happened.',
    });
  });
});

describe('formatReading', () => {
  it('puts a currency sign in front and any other unit after', () => {
    expect(formatReading(18250.4, '$')).toBe('$18,250.4');
    expect(formatReading(-20, '$')).toBe('-$20');
    expect(formatReading(182.5, 'lb')).toBe('182.5 lb');
    expect(formatReading(3, null)).toBe('3');
  });
});

describe('sortReadings', () => {
  it('orders by day and keeps entry order within a day', () => {
    const sorted = sortReadings([
      reading('b', '2026-09-10', 2),
      reading('a', '2026-09-01', 1),
      reading('c', '2026-09-10', 3),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('movementLine', () => {
  it('says how a debt has come down and what is left', () => {
    const readings = [reading('a', '2026-06-01', 18000), reading('b', '2026-09-01', 15500)];
    expect(movementLine(readings, { unit: '$', target: 0 }, day)).toBe(
      'Down $2,500 since 2026-06-01, $15,500 to go',
    );
  });

  it('says how a weight has gone up, and when the target is reached', () => {
    const readings = [reading('a', '2026-06-01', 185), reading('b', '2026-09-01', 230)];
    expect(movementLine(readings, { unit: 'lb', target: 225 }, day)).toBe(
      'Up 45 lb since 2026-06-01, target reached',
    );
  });

  it('gives the one reading when there is only one, and nothing with none', () => {
    expect(movementLine([reading('a', '2026-09-01', 185)], { unit: 'lb', target: null }, day)).toBe(
      '185 lb on 2026-09-01',
    );
    expect(movementLine([], { unit: 'lb', target: null }, day)).toBeNull();
  });
});

describe('readingChart', () => {
  const size = { width: 600, height: 160 };

  it('places points by date, so a long gap looks long', () => {
    const chart = readingChart(
      [
        reading('a', '2026-01-01', 10),
        reading('b', '2026-01-02', 10),
        reading('c', '2026-01-11', 10),
      ],
      null,
      size,
    )!;
    const [a, b, c] = chart.points.map((p) => p.x);
    expect(a).toBe(chart.plot.left);
    expect(c).toBe(chart.plot.right);
    expect(b - a).toBeCloseTo((c - a) / 10);
  });

  it('takes the target into the scale, and higher values sit higher', () => {
    const chart = readingChart(
      [reading('a', '2026-01-01', 18000), reading('b', '2026-02-01', 15000)],
      0,
      size,
    )!;
    expect(chart.low).toBe(0);
    expect(chart.high).toBe(18000);
    expect(chart.targetY).toBeGreaterThan(chart.points[1].y);
    expect(chart.points[0].y).toBeLessThan(chart.points[1].y);
    for (const y of [chart.targetY!, ...chart.points.map((p) => p.y)]) {
      expect(y).toBeGreaterThanOrEqual(chart.plot.top);
      expect(y).toBeLessThanOrEqual(chart.plot.bottom);
    }
    expect(chart.path).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
  });

  it('draws one reading as a point in the middle with no line', () => {
    const chart = readingChart([reading('a', '2026-01-01', 185)], null, size)!;
    expect(chart.path).toBeNull();
    expect(chart.points[0].x).toBe(300);
    expect(chart.points[0].y).toBeCloseTo(80);
  });

  it('draws nothing with no readings', () => {
    expect(readingChart([], 5, size)).toBeNull();
  });
});

describe('a number worked out from a collection (plan #1024)', () => {
  const loans = {
    id: 'c1',
    name: 'loans',
    fields: [
      { key: 'name', label: 'Loan', type: 'text' as const },
      { key: 'balance', label: 'Balance', type: 'money' as const, tracked: true },
      { key: 'rate', label: 'Interest rate', type: 'percent' as const },
      { key: 'old', label: 'Old', type: 'number' as const, removed: true },
    ],
  };

  it('offers the total and latest of each number field, and a count', () => {
    const choices = numberFromChoices([loans]);
    expect(choices.map((c) => [c.value, c.label, c.unit])).toEqual([
      ['sum|c1|balance', 'Total balance of loans', '$'],
      ['latest|c1|balance', 'Latest balance of loans', '$'],
      ['sum|c1|rate', 'Total interest rate of loans', '%'],
      ['latest|c1|rate', 'Latest interest rate of loans', '%'],
      ['count|c1|', 'Number of loans', 'loans'],
    ]);
  });

  it('takes only a choice on offer, and empty for typing it in', () => {
    const choices = numberFromChoices([loans]);
    expect(parseNumberFrom('sum|c1|balance', choices)).toEqual({ ok: true, value: choices[0] });
    expect(parseNumberFrom('', choices)).toEqual({ ok: true, value: null });
    expect(parseNumberFrom('sum|c1|name', choices).ok).toBe(false);
    expect(parseNumberFrom('sum|c2|balance', choices).ok).toBe(false);
  });
});

describe('when the target will be reached (plan #1025)', () => {
  // Three falling readings, $1,000 a month off a $10,000 debt.
  const falling = [
    reading('a', '2026-07-01', 12000),
    reading('b', '2026-07-31', 11000),
    reading('c', '2026-08-30', 10000),
  ];

  it('projects a date from three falling readings and says it is ahead of the due date', () => {
    const projection = projectTarget(falling, 0, '2027-12-31');
    expect(projection).toEqual({
      kind: 'reaches',
      reachOn: '2027-06-26',
      dueOn: '2027-12-31',
      daysEarly: 188,
    });
    expect(projectionLine(projection!, day)).toBe(
      'At this pace, target reached 2027-06-26: ahead, 6 months before the due date of 2027-12-31',
    );
  });

  it('says it is behind when the pace misses the due date', () => {
    const projection = projectTarget(falling, 0, '2027-01-01');
    expect(projection).toMatchObject({ kind: 'reaches', daysEarly: -176 });
    expect(projectionLine(projection!, day)).toBe(
      'At this pace, target reached 2027-06-26: behind, 6 months after the due date of 2027-01-01',
    );
  });

  it('gives the date alone without a due date, and works for a number counting up', () => {
    const projection = projectTarget(falling, 0, null);
    expect(projectionLine(projection!, day)).toBe('At this pace, target reached 2027-06-26');
    const lifting = [
      reading('a', '2026-09-01', 185),
      reading('b', '2026-09-08', 190),
      reading('c', '2026-09-15', 195),
    ];
    expect(projectTarget(lifting, 225, null)).toMatchObject({ reachOn: '2026-10-27' });
  });

  it('shows nothing with fewer than three readings, no target, or the target reached', () => {
    expect(projectTarget(falling.slice(0, 2), 0, null)).toBeNull();
    expect(projectTarget(falling, null, null)).toBeNull();
    expect(projectTarget(falling, 10000, null)).toBeNull();
  });

  it('says the number is not closing when the recent pace is flat or the wrong way', () => {
    const rising = [...falling, reading('d', '2026-09-29', 11000), reading('e', '2026-10-29', 12500)];
    const projection = projectTarget(rising.slice(-3), 0, null);
    expect(projection).toEqual({ kind: 'not-closing' });
    expect(projectionLine(projection!, day)).toBe('Not closing on the target at the recent pace');
  });

  it('reads the due date from the measure line, and leaves it alone when not sent', () => {
    expect(parseMeasureFields(form({ unit: '$', target: '0', dueOn: '2028-01-31' }))).toEqual({
      ok: true,
      value: { unit: '$', target: 0, dueOn: '2028-01-31' },
    });
    expect(parseMeasureFields(form({ unit: '$', target: '0', dueOn: '' }))).toEqual({
      ok: true,
      value: { unit: '$', target: 0, dueOn: null },
    });
    const untouched = parseMeasureFields(form({ unit: '$', target: '0' }));
    expect(untouched.ok && 'dueOn' in untouched.value).toBe(false);
    expect(parseMeasureFields(form({ unit: '$', target: '0', dueOn: 'soon' })).ok).toBe(false);
  });

  it('words a span of days', () => {
    expect(spanWords(1)).toBe('1 day');
    expect(spanWords(-21)).toBe('3 weeks');
    expect(spanWords(188)).toBe('6 months');
    expect(spanWords(800)).toBe('2 years');
  });
});
