import { describe, expect, it } from 'vitest';

import citiJob from './fixtures/workday-citi-job.json';
import citiJobs from './fixtures/workday-citi-jobs.json';
import { readPages, toPosting, toPostings, type WorkdayPage } from './workday';
import { parseWorkdayToken, workdayFromUrl, workdayToken } from './workday-token';

/**
 * The fixtures are Citi's board as its career site API answered on
 * 25 October 2026: the first page of `/wday/cxs/citi/2/jobs`, and the detail
 * of its first posting (with the similar-jobs list cut).
 */

const CITI = { tenant: 'citi', wd: 'wd5', site: '2' };

describe('workday tokens', () => {
  it('reads tenant, data centre and site from a career site link', () => {
    expect(workdayFromUrl(new URL('https://citi.wd5.myworkdayjobs.com/en-US/2'))).toEqual({ board: CITI, jobId: null });
    expect(workdayFromUrl(new URL('https://Citi.WD5.myworkdayjobs.com/2?locationCountry=abc'))).toEqual({ board: CITI, jobId: null });
  });

  it('reads the posting id from a posting link', () => {
    const found = workdayFromUrl(
      new URL('https://citi.wd5.myworkdayjobs.com/en-US/2/job/London--United-Kingdom/Senior-Analyst_261002352?source=x'),
    );
    expect(found).toEqual({ board: CITI, jobId: 'London--United-Kingdom/Senior-Analyst_261002352' });
  });

  it('names no board for the tenant root or a Workday page', () => {
    expect(workdayFromUrl(new URL('https://citi.wd5.myworkdayjobs.com/'))?.board).toBeNull();
    expect(workdayFromUrl(new URL('https://citi.wd5.myworkdayjobs.com/en-US/login'))?.board).toBeNull();
    expect(workdayFromUrl(new URL('https://www.workday.com/careers'))).toBeNull();
  });

  it('round-trips a token and refuses anything else', () => {
    expect(parseWorkdayToken(workdayToken(CITI))).toEqual(CITI);
    expect(parseWorkdayToken('citi')).toBeNull();
    expect(parseWorkdayToken('citi/5/2')).toBeNull();
    expect(parseWorkdayToken('citi/wd5/../x')).toBeNull();
    expect(parseWorkdayToken('citi/wd5/jobs')).toBeNull();
  });
});

describe('workday board listing', () => {
  it('maps a real page of Citi’s board, with no description yet', () => {
    const postings = toPostings(citiJobs as WorkdayPage, CITI);
    expect(postings).toHaveLength(20);
    const first = postings[0];
    expect(first).toMatchObject({
      vendor: 'workday',
      title: 'Senior Vice President, Payments Cluster Product Management – Industry & Regulatory Liaison',
      text: '',
      location: 'London  United Kingdom',
      boardToken: 'citi/wd5/2',
      atsJobId:
        'London--United-Kingdom/Senior-Vice-President--Payments-Cluster-Product-Management---Industry---Regulatory-Liaison_261002352',
    });
    // The same link the posting's own detail gives as its address.
    expect(first.url).toBe(citiJob.jobPostingInfo.externalUrl);
  });

  it('leaves out a listing with no posting path', () => {
    expect(toPostings({ jobPostings: [{ title: 'Analyst' }, { title: '', externalPath: '/job/x/y' }] }, CITI)).toEqual([]);
  });
});

describe('workday posting detail', () => {
  it('maps a real posting with its description', () => {
    const jobId =
      'London--United-Kingdom/Senior-Vice-President--Payments-Cluster-Product-Management---Industry---Regulatory-Liaison_261002352';
    const posting = toPosting(citiJob, CITI, jobId);
    expect(posting.title).toMatch(/^Senior Vice President, Payments Cluster/);
    expect(posting.text).toMatch(/^Are you looking for a career move/);
    expect(posting.text).not.toMatch(/<p>/);
    expect(posting.atsJobId).toBe(jobId);
    expect(posting.location).toBe('London  United Kingdom');
    expect(posting.company).toBeUndefined();
  });

  it('throws rather than returning a nameless posting', () => {
    expect(() => toPosting({}, CITI, 'x/y')).toThrow(/no posting/);
  });
});

describe('reading every page', () => {
  const page = (offset: number, total = 0): WorkdayPage => ({
    total,
    jobPostings: Array.from({ length: 20 }, (_, i) => ({
      title: `Role ${offset + i}`,
      externalPath: `/job/Somewhere/Role_${offset + i}`,
    })),
  });

  it('reads every page the first one counts, which alone carries the total', async () => {
    const offsets: number[] = [];
    const postings = await readPages(CITI, async (offset) => {
      offsets.push(offset);
      return offset === 0 ? page(0, 95) : page(offset);
    });
    expect(offsets.sort((a, b) => a - b)).toEqual([0, 20, 40, 60, 80]);
    expect(postings).toHaveLength(100);
    expect(new Set(postings.map((posting) => posting.atsJobId)).size).toBe(100);
  });

  it('keeps what was read when the time runs out', async () => {
    const postings = await readPages(
      CITI,
      (offset) =>
        offset === 0
          ? Promise.resolve(page(0, 400))
          : offset < 80
            ? Promise.resolve(page(offset))
            : new Promise<WorkdayPage>(() => {}),
      200,
    );
    expect(postings).toHaveLength(80);
  });

  it('keeps what was read when a later page fails', async () => {
    const postings = await readPages(CITI, async (offset) => {
      if (offset === 0) return page(0, 200);
      if (offset >= 40) throw new Error('Workday returned 500 for that board.');
      return page(offset);
    });
    expect(postings.map((posting) => posting.title).slice(-1)).toEqual(['Role 39']);
    expect(postings).toHaveLength(40);
  });

  it('drops a posting a shifted page repeats', async () => {
    const postings = await readPages(CITI, async (offset) =>
      offset === 0 ? page(0, 40) : { jobPostings: [...page(19).jobPostings!] },
    );
    expect(postings).toHaveLength(39);
  });

  it('throws when the first page does not answer, since then there is no board', async () => {
    await expect(
      readPages(CITI, async () => {
        throw new Error('Workday returned 404 for that board.');
      }),
    ).rejects.toThrow(/404/);
  });
});
