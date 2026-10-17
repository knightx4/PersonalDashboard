import { describe, expect, it } from 'vitest';
import { isLookNote, sentBackDates, sentBackShare, sentBackWeeks, type CheckRow } from './sent-back';

const pass = (step: number, surface: string, at: string): CheckRow => ({
  step,
  surface,
  verdict: 'pass',
  created_at: at,
});

const now = new Date('2026-10-16T12:00:00Z');

describe('sentBackDates', () => {
  it('reads the lines sendScreenBack wrote', () => {
    const comment =
      'Added.\nSent back 2026-10-07 from the jobs-company pictures: too tight\nSent back 2026-10-14 from the jobs-company pictures: still tight';
    expect(sentBackDates(comment)).toEqual(['2026-10-07', '2026-10-14']);
    expect(sentBackDates(null)).toEqual([]);
  });
});

describe('isLookNote', () => {
  it('tells a note about looks from one about behaviour', () => {
    expect(isLookNote('the popup box getting cut off')).toBe(true);
    expect(isLookNote('the font is too small')).toBe(true);
    expect(isLookNote('let me filter on each column by clicking that column')).toBe(false);
  });
});

describe('sentBackWeeks', () => {
  const checks = [
    pass(10, 'jobs-company', '2026-09-02T10:00:00Z'),
    pass(11, 'dev-ui', '2026-09-03T10:00:00Z'),
    pass(12, 'dev-ui', '2026-10-06T10:00:00Z'),
  ];

  it('counts shipped steps by the week of their first passing check, from 31 August', () => {
    const weeks = sentBackWeeks(checks, [], [], now);
    expect(weeks[0]).toEqual({ week: '2026-08-31', shipped: 2, sentBack: 0 });
    expect(weeks.find((w) => w.week === '2026-10-05')?.shipped).toBe(1);
    expect(weeks.at(-1)?.week).toBe('2026-10-12');
  });

  it('counts a step sent back in the week of its line, once', () => {
    const weeks = sentBackWeeks(
      [...checks, pass(10, 'jobs-company', '2026-10-08T10:00:00Z')],
      [
        {
          number: 10,
          comment:
            'Sent back 2026-10-07 from the jobs-company pictures: a\nSent back 2026-10-08 from the jobs-company pictures: b',
        },
      ],
      [],
      now,
    );
    expect(weeks.find((w) => w.week === '2026-10-05')?.sentBack).toBe(1);
    expect(weeks.reduce((sum, w) => sum + w.sentBack, 0)).toBe(1);
  });

  it('counts a look note within 7 days of a pass, not a later one or one about something else', () => {
    const weeks = sentBackWeeks(
      checks,
      [],
      [
        { created_at: '2026-09-05T09:00:00Z', page_path: '/jobs/companies/acme', body: 'the spacing is off' },
        { created_at: '2026-09-20T09:00:00Z', page_path: '/jobs/companies/acme', body: 'the spacing is off' },
        { created_at: '2026-09-06T09:00:00Z', page_path: '/jobs/companies/acme', body: 'add a filter' },
      ],
      now,
    );
    expect(weeks.find((w) => w.week === '2026-08-31')?.sentBack).toBe(1);
    expect(weeks.find((w) => w.week === '2026-09-14')?.sentBack).toBe(0);
  });

  it('gives no weeks before any check has passed', () => {
    expect(sentBackWeeks([], [], [], now)).toEqual([]);
  });
});

describe('sentBackShare', () => {
  it('is a whole percentage, and null when nothing shipped', () => {
    expect(sentBackShare({ week: 'w', shipped: 8, sentBack: 1 })).toBe(13);
    expect(sentBackShare({ week: 'w', shipped: 0, sentBack: 0 })).toBeNull();
  });
});
