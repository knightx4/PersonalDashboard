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
  source: null,
  position: 0,
  created_at: '2026-10-12T09:00:00Z',
  updated_at: '2026-10-12T09:00:00Z',
  ...fields,
});

export const workHistoryJobs: Job[] = sortJobs([
  job({ id: 'j-advisor', employer: 'Stealth startup', title: 'Strategic Finance Advisor (part-time)', place: 'Portland, OR', started: '2025-02', position: 0 }),
  job({
    id: 'j-audit',
    employer: 'Halvorsen & Co. Partners LLP, Audit and Assurance Services Practice',
    title: 'Assurance Senior',
    place: 'Denver, CO',
    started: '2020-09',
    ended: '2023-07',
    note: 'Led year-end inventory counts for three manufacturing clients and trained the new staff on them.',
    edited: true,
    position: 1,
  }),
  job({ id: 'j-intern', employer: 'Marlow Partners', title: 'Audit Intern', place: 'Denver, CO', started: '2019-06', ended: '2019-08', position: 2 }),
  job({ id: 'j-shop', employer: 'Corner bookshop', started: '2014', ended: '2016', edited: true, resume_id: null, resume_hash: null }),
]);

export const workHistoryResume = { label: '2026' };
