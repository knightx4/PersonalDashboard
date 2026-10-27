import { describe, expect, it, vi } from 'vitest';
import { JOBS_MAX, readWorkHistory, readWorkHistoryAnswer, workHistoryTool, WORK_HISTORY_TOOL } from './work-history-read';

describe('readWorkHistoryAnswer', () => {
  it('keeps each job as written, with a current job open-ended', () => {
    expect(
      readWorkHistoryAnswer({
        jobs: [
          { employer: 'Stealth startup', title: 'Strategic Finance Advisor', place: 'Portland, OR', started: '2025', ended: '2026', current: false },
          { employer: '  Halvorsen & Co. ', title: 'Assurance Senior', place: 'Denver, CO', started: '2020-09', ended: '2023-07', current: false },
          { employer: 'Acme', title: null, place: null, started: '2024', ended: '2025', current: true },
        ],
      }),
    ).toEqual([
      { employer: 'Stealth startup', title: 'Strategic Finance Advisor', place: 'Portland, OR', started: '2025', ended: '2026' },
      { employer: 'Halvorsen & Co.', title: 'Assurance Senior', place: 'Denver, CO', started: '2020-09', ended: '2023-07' },
      { employer: 'Acme', title: null, place: null, started: '2024', ended: null },
    ]);
  });

  it('drops a job with no employer, an unreadable date, and an end before the start', () => {
    expect(
      readWorkHistoryAnswer({
        jobs: [
          { employer: '', title: 'Ghost' },
          { employer: 'Acme', title: 'Analyst', started: 'last spring', ended: '2019-02', current: false },
          { employer: 'Beta', title: 'Lead', started: '2022', ended: '2019', current: false },
          'not a job',
        ],
      }),
    ).toEqual([
      { employer: 'Acme', title: 'Analyst', place: null, started: null, ended: '2019-02' },
      { employer: 'Beta', title: 'Lead', place: null, started: '2022', ended: null },
    ]);
  });

  it('stops at the most a read keeps, and reads nothing from a malformed answer', () => {
    const many = Array.from({ length: JOBS_MAX + 5 }, (_, i) => ({ employer: `Firm ${i}` }));
    expect(readWorkHistoryAnswer({ jobs: many })).toHaveLength(JOBS_MAX);
    expect(readWorkHistoryAnswer(null)).toEqual([]);
    expect(readWorkHistoryAnswer({ jobs: 'none' })).toEqual([]);
  });
});

describe('readWorkHistory', () => {
  it('asks once with the résumé text and hands back the jobs', async () => {
    const ask = vi.fn(async () => ({ ok: true as const, input: { jobs: [{ employer: 'Halvorsen & Co.', started: '2020' }] } }));
    await expect(readWorkHistory('  ALEX RIVERA\nHALVORSEN & CO. 2020 - 2023  ', ask)).resolves.toEqual({
      ok: true,
      jobs: [{ employer: 'Halvorsen & Co.', title: null, place: null, started: '2020', ended: null }],
    });
    expect(ask).toHaveBeenCalledWith('ALEX RIVERA\nHALVORSEN & CO. 2020 - 2023');
  });

  it('says so when there is no text, nothing comes back, or the call fails', async () => {
    const never = vi.fn();
    expect(await readWorkHistory('   ', never)).toMatchObject({ ok: false });
    expect(never).not.toHaveBeenCalled();
    expect(await readWorkHistory('text', async () => ({ ok: true, input: { jobs: [] } }))).toEqual({
      ok: false,
      error: 'No jobs could be read from your résumé. Add them here yourself.',
    });
    expect(await readWorkHistory('text', async () => ({ ok: false, error: 'Rate-limited.' }))).toEqual({
      ok: false,
      error: 'Rate-limited.',
    });
  });
});

describe('workHistoryTool', () => {
  it('asks for every field it reads back', () => {
    const tool = workHistoryTool();
    expect(tool.name).toBe(WORK_HISTORY_TOOL);
    const items = (tool.input_schema.properties as { jobs: { items: { required: string[] } } }).jobs.items;
    expect(items.required).toEqual(['employer', 'title', 'place', 'started', 'ended', 'current']);
  });
});
