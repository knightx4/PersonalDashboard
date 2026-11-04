import { describe, expect, it } from 'vitest';
import {
  dateLabel,
  jobDates,
  parseJob,
  parseMonthDate,
  planRead,
  resumeChanged,
  sortJobs,
  type DraftJob,
} from './work-history';

describe('parseMonthDate', () => {
  it('reads a year, a month and year in any common order, and empty as none', () => {
    expect(parseMonthDate('2020')).toEqual({ ok: true, value: '2020' });
    expect(parseMonthDate('2020-5')).toEqual({ ok: true, value: '2020-05' });
    expect(parseMonthDate('05/2020')).toEqual({ ok: true, value: '2020-05' });
    expect(parseMonthDate('May 2020')).toEqual({ ok: true, value: '2020-05' });
    expect(parseMonthDate('Sept. 2019')).toEqual({ ok: true, value: '2019-09' });
    expect(parseMonthDate('  ')).toEqual({ ok: true, value: null });
  });

  it('refuses what is not a date', () => {
    expect(parseMonthDate('ages ago').ok).toBe(false);
    expect(parseMonthDate('2020-13').ok).toBe(false);
    expect(parseMonthDate('1850').ok).toBe(false);
  });
});

describe('dates on a row', () => {
  it('reads as a span, with an open end as now', () => {
    expect(dateLabel('2020-05')).toBe('May 2020');
    expect(jobDates({ started: '2020', ended: '2023' })).toBe('2020 – 2023');
    expect(jobDates({ started: '2025-01', ended: null })).toBe('Jan 2025 – now');
    expect(jobDates({ started: '2021', ended: '2021' })).toBe('2021');
    expect(jobDates({ started: null, ended: null })).toBeNull();
  });
});

describe('parseJob', () => {
  const form = (values: Record<string, string>) => (field: string) => values[field] ?? '';

  it('keeps what was typed, with empty fields as none', () => {
    expect(parseJob(form({ employer: ' Halvorsen & Co. ', title: 'Assurance Senior', started: '2020', ended: '' }))).toEqual({
      ok: true,
      job: { employer: 'Halvorsen & Co.', title: 'Assurance Senior', place: null, note: null, started: '2020', ended: null },
    });
  });

  it('names the field it refuses', () => {
    expect(parseJob(form({ employer: '' }))).toMatchObject({ ok: false, field: 'employer' });
    expect(parseJob(form({ employer: 'Halvorsen & Co.', started: 'soon' }))).toMatchObject({ ok: false, field: 'started' });
    expect(parseJob(form({ employer: 'Halvorsen & Co.', started: '2022', ended: '2020' }))).toMatchObject({ ok: false, field: 'ended' });
  });
});

describe('sortJobs', () => {
  it('puts the job held now first, then by start, newest first', () => {
    const jobs = [
      { id: 'a', started: '2016', ended: '2018', position: 2 },
      { id: 'b', started: '2020', ended: '2023', position: 1 },
      { id: 'c', started: '2019', ended: null, position: 0 },
      { id: 'd', started: null, ended: null, position: 3 },
    ];
    expect(sortJobs(jobs).map((job) => job.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});

describe('planRead', () => {
  const read = (employer: string, started: string | null, title: string | null = null): DraftJob => ({
    employer,
    title,
    place: null,
    started,
    ended: null,
  });

  it('replaces what Dash read before and keeps every row the person edited or added', () => {
    const plan = planRead(
      [
        { id: 'dash', employer: 'Halvorsen', title: 'Senior', started: '2020', edited: false },
        { id: 'mine', employer: 'Halvorsen & Co. LLP', title: 'Senior', started: '2020', edited: true },
        { id: 'added', employer: 'Corner shop', title: null, started: '2014', edited: true },
      ],
      [read('Halvorsen & Co.', '2020-06'), read('Stealth startup', '2025')],
    );
    expect(plan.remove).toEqual(['dash']);
    // The person's Halvorsen row matches the read's Halvorsen row, so it is not added twice.
    expect(plan.add).toEqual([read('Stealth startup', '2025')]);
    expect(plan.kept).toBe(2);
    expect(plan.confirmed).toEqual(['mine']);
  });

  it('matches on the title when either has no start', () => {
    const plan = planRead([{ id: 'mine', employer: 'Acme', title: 'Analyst', started: null, edited: true }], [
      read('Acme', '2019', 'Analyst'),
      read('Acme', '2021', 'Manager'),
    ]);
    expect(plan.add).toEqual([read('Acme', '2021', 'Manager')]);
  });

  it('keeps the jobs the LinkedIn import wrote or filled in (plan #2432.7)', () => {
    const plan = planRead(
      [{ id: 'linkedin', employer: 'Hooli', title: 'PM', started: '2025-07', edited: false, source: 'linkedin' }],
      [read('Hooli', '2025-07', 'PM')],
    );
    expect(plan.remove).toEqual([]);
    expect(plan.add).toEqual([]);
  });
});

describe('resumeChanged', () => {
  const resume = { id: 'r', label: '2026', hash: 'b'.repeat(32) };

  it('offers a new read only when rows were read and none from this text', () => {
    expect(resumeChanged(resume, [{ resume_hash: 'a'.repeat(32) }])).toBe(true);
    expect(resumeChanged(resume, [{ resume_hash: 'a'.repeat(32) }, { resume_hash: 'b'.repeat(32) }])).toBe(false);
    expect(resumeChanged(resume, [{ resume_hash: null }])).toBe(false);
    expect(resumeChanged(null, [{ resume_hash: 'a'.repeat(32) }])).toBe(false);
  });
});
