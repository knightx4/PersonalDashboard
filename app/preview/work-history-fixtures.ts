import { sortJobs, type Job } from '@/lib/you/work-history';

/**
 * Fixtures for the jobs on the Work & school tab (plan #1991.4): a current
 * job, two read from the résumé, one the person corrected, one they added
 * with no title, and a long employer name to wrap.
 */

const USER = '00000000-0000-4000-8000-000000000001';
const RESUME = '00000000-0000-4000-8000-0000000000a1';
const OLD = 'a'.repeat(32);

const job = (fields: Partial<Job> & Pick<Job, 'id' | 'employer'>): Job => ({
  user_id: USER,
  title: null,
  place: null,
  started: null,
  ended: null,
  note: null,
  edited: false,
  resume_id: RESUME,
  resume_hash: OLD,
  position: 0,
  created_at: '2026-10-12T09:00:00Z',
  updated_at: '2026-10-12T09:00:00Z',
  ...fields,
});

export const workHistoryJobs: Job[] = sortJobs([
  job({ id: 'j-advisor', employer: 'Stealth startup', title: 'Strategic Finance Advisor (part-time)', place: 'New Haven, CT', started: '2025-02', position: 0 }),
  job({
    id: 'j-ey',
    employer: 'Ernst & Young Global Limited, Assurance Services Practice',
    title: 'Assurance Senior',
    place: 'Dallas, TX',
    started: '2020-09',
    ended: '2023-07',
    note: 'Built the automated revenue testing tool the firm later rolled out to other engagements.',
    edited: true,
    position: 1,
  }),
  job({ id: 'j-intern', employer: 'Deloitte', title: 'Audit Intern', place: 'Houston, TX', started: '2019-06', ended: '2019-08', position: 2 }),
  job({ id: 'j-shop', employer: 'Corner bookshop', started: '2014', ended: '2016', edited: true, resume_id: null, resume_hash: null }),
]);

export const workHistoryResume = { label: '2026' };
