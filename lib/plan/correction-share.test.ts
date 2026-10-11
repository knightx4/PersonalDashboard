import { describe, expect, it } from 'vitest';
import { correctionWeeks, sharePercent, surfacesOfNote, weekOf, type ChangeRow } from './correction-share';

const pass = (surface: string, at: string, step: number | null = 1587): ChangeRow => ({
  step,
  surface,
  verdict: 'pass',
  created_at: at,
});

describe('weekOf', () => {
  it('starts a week on Monday in UTC', () => {
    expect(weekOf(Date.parse('2026-10-04T23:59:00Z'))).toBe('2026-09-28');
    expect(weekOf(Date.parse('2026-10-05T00:00:00Z'))).toBe('2026-10-05');
    expect(weekOf(Date.parse('2026-10-11T12:00:00Z'))).toBe('2026-10-05');
  });
});

describe('surfacesOfNote', () => {
  it('matches a page to the surfaces of its route, leaving off the query', () => {
    expect(surfacesOfNote('/jobs/companies/concourse?tab=people')).toEqual(
      expect.arrayContaining(['jobs-company', 'jobs-company-add-person']),
    );
  });

  it('takes the surface a note on /dev/surfaces names', () => {
    expect(surfacesOfNote('/preview?s=jobs-company')).toEqual(['jobs-company']);
  });

  it('gives nothing for no page', () => {
    expect(surfacesOfNote(null)).toEqual([]);
  });
});

describe('correctionWeeks', () => {
  const now = new Date('2026-10-07T12:00:00Z');

  it('counts a note on a page changed in the 30 days before it, week by week', () => {
    const weeks = correctionWeeks(
      [pass('jobs-company', '2026-10-04T04:17:00Z')],
      [
        { created_at: '2026-10-04T21:59:00Z', page_path: '/jobs/companies/concourse' },
        { created_at: '2026-10-04T22:00:00Z', page_path: '/learn/videos' },
        { created_at: '2026-10-05T10:00:00Z', page_path: '/preview?s=jobs-company' },
      ],
      now,
    );
    expect(weeks).toEqual([
      { week: '2026-09-28', notes: 2, corrections: 1 },
      { week: '2026-10-05', notes: 1, corrections: 1 },
    ]);
  });

  it('does not count a note filed before the change, or more than 30 days after it', () => {
    const weeks = correctionWeeks(
      [pass('jobs-company', '2026-09-01T10:00:00Z')],
      [
        { created_at: '2026-09-01T09:00:00Z', page_path: '/jobs/companies/a' },
        { created_at: '2026-10-02T10:00:00Z', page_path: '/jobs/companies/a' },
        { created_at: '2026-09-30T10:00:00Z', page_path: '/jobs/companies/a' },
      ],
      now,
    );
    const total = weeks.reduce((sum, week) => sum + week.corrections, 0);
    expect(total).toBe(1);
    expect(weeks[0].week).toBe('2026-08-31');
    expect(weeks.at(-1)?.week).toBe('2026-10-05');
  });

  it('ignores a failed round and a check with no step', () => {
    const weeks = correctionWeeks(
      [
        { step: 1587, surface: 'jobs-company', verdict: 'fix', created_at: '2026-10-04T01:00:00Z' },
        pass('jobs-company', '2026-10-04T01:00:00Z', null),
        pass('learn-clips', '2026-10-05T01:00:00Z'),
      ],
      [{ created_at: '2026-10-05T09:00:00Z', page_path: '/jobs/companies/a' }],
      now,
    );
    expect(weeks).toEqual([{ week: '2026-10-05', notes: 1, corrections: 0 }]);
  });

  it('has no weeks before any change', () => {
    expect(correctionWeeks([], [{ created_at: '2026-10-05T09:00:00Z', page_path: '/' }], now)).toEqual(
      [],
    );
  });
});

describe('sharePercent', () => {
  it('rounds to a whole percentage and gives null for a week with no notes', () => {
    expect(sharePercent({ week: '2026-10-05', notes: 3, corrections: 1 })).toBe(33);
    expect(sharePercent({ week: '2026-10-05', notes: 0, corrections: 0 })).toBeNull();
  });
});

describe('surfacesOfNote, where two patterns fit', () => {
  it('keeps the page Next would serve: fixed segments beat a placeholder', () => {
    const files = surfacesOfNote('/goals/files');
    expect(files).not.toContain('goals-page-top');
    const goal = surfacesOfNote('/goals/f74f7d8c-1222-4dbd-9ba5-abc47e70fa82');
    expect(goal).toContain('goals-page-top');
  });
});
