import { groupProfile, type ProfileEntry, type ProfileLists } from '@/lib/you/profile-entries';
import { sortJobs, type Job } from '@/lib/you/work-history';
import { workHistoryJobs } from './work-history-fixtures';

/**
 * Fixtures for the LinkedIn profile on the Work & school tab (plan #2432.7):
 * one school with activities and a course on no transcript, two
 * certifications (one with a link and a license number, one with a long
 * name), an honor, a run of skills to wrap, and the jobs with two that came
 * from LinkedIn.
 */

const entry = (fields: Partial<ProfileEntry> & Pick<ProfileEntry, 'id' | 'kind' | 'name'>): ProfileEntry => ({
  detail: null,
  started: null,
  ended: null,
  description: null,
  activities: null,
  url: null,
  code: null,
  position: 0,
  ...fields,
});

export const profileLists: ProfileLists = groupProfile([
  entry({
    id: 'p-school',
    kind: 'school',
    name: 'The University of Texas at Austin, McCombs School of Business',
    detail: 'Master of Professional Accounting (MPA)',
    started: '2015',
    ended: '2020',
    activities: 'Texas Accounting Society, intramural soccer',
  }),
  entry({ id: 'p-course-1', kind: 'course', name: 'Financial Statement Analysis', code: 'ACC 380K', position: 0 }),
  entry({ id: 'p-course-2', kind: 'course', name: 'Data Analytics for Auditors', position: 1 }),
  entry({
    id: 'p-cpa',
    kind: 'certification',
    name: 'Certified Public Accountant (CPA)',
    detail: 'Texas State Board of Public Accountancy',
    started: '2021-04',
    code: '123456',
    position: 0,
  }),
  entry({
    id: 'p-yale',
    kind: 'certification',
    name: 'Quantum Computing for Everyone: Foundations, Algorithms and Applications',
    detail: 'Yale University',
    started: '2025-11',
    ended: '2025-11',
    url: 'https://example.com/certificate/yale-quantum',
    position: 1,
  }),
  entry({
    id: 'p-honor',
    kind: 'honor',
    name: 'Elijah Watt Sells Award',
    started: '2021-06',
    description: 'For the highest cumulative scores on all four sections of the CPA exam, one of 105 candidates that year.',
  }),
  ...['Financial modeling', 'SQL', 'Revenue recognition (ASC 606)', 'Python', 'Audit', 'Stakeholder management', 'Tableau', 'Excel'].map(
    (name, position) => entry({ id: `p-skill-${position}`, kind: 'skill', name, position }),
  ),
]);

export const profileListsEmpty: ProfileLists = groupProfile([]);

/** The jobs, with one LinkedIn added and the résumé's Deloitte row it filled in. */
export const profileJobs: Job[] = sortJobs([
  ...workHistoryJobs.map((job) => (job.id === 'j-intern' ? { ...job, source: 'linkedin', note: 'Tested controls over revenue for two retail clients.' } : job)),
  {
    ...workHistoryJobs[0],
    id: 'j-linkedin',
    employer: 'Texas Accounting Society',
    title: 'Treasurer (student chapter)',
    place: 'Austin, TX',
    started: '2017-09',
    ended: '2019-05',
    note: null,
    edited: false,
    resume_id: null,
    resume_hash: null,
    source: 'linkedin',
    position: 0,
  },
]);
