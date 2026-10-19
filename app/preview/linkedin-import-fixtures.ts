import type { Counts } from '@/lib/imports/types';
import { kindLabel, type KindCountsView, type LinkedInPlanView, type LinkedInRunView } from '@/lib/jobs/linkedin-import';

// The LinkedIn tab of Jobs settings in the gallery (plan #2432.9): an export
// the size of the real one (392 applications, 600 messages), its first
// import and a rerun that changes little.

const c = (added: number, updated = 0, unchanged = 0, kept = 0, skipped = 0): Counts => ({
  added,
  updated,
  unchanged,
  kept,
  skipped,
});

const kind = (k: string, counts: Counts): KindCountsView => ({ kind: k, label: kindLabel(k), counts });

const total = (kinds: KindCountsView[]): Counts =>
  kinds.reduce(
    (t, k) => ({
      added: t.added + k.counts.added,
      updated: t.updated + k.counts.updated,
      unchanged: t.unchanged + k.counts.unchanged,
      kept: t.kept + k.counts.kept,
      skipped: t.skipped + k.counts.skipped,
    }),
    c(0),
  );

const firstKinds = [
  kind('applications', c(371, 18, 0, 0, 3)),
  kind('screeningAnswers', c(41)),
  kind('connections', c(1186, 32)),
  kind('messages', c(598, 0, 0, 0, 2)),
  kind('invitations', c(87)),
  kind('savedJobs', c(54)),
  kind('companyFollows', c(112)),
  kind('positions', c(6)),
  kind('education', c(2)),
  kind('skills', c(38)),
  kind('learning', c(23)),
];

const rerunKinds = [
  kind('applications', c(4, 2, 380, 3, 3)),
  kind('screeningAnswers', c(0, 0, 41)),
  kind('connections', c(9, 1, 1203, 5)),
  kind('messages', c(36, 0, 598, 0, 2)),
  kind('invitations', c(2, 0, 87)),
  kind('savedJobs', c(1, 0, 53, 1)),
  kind('companyFollows', c(0, 0, 112)),
  kind('positions', c(0, 0, 5, 1)),
  kind('education', c(0, 0, 2)),
  kind('skills', c(0, 0, 38)),
  kind('learning', c(2, 1, 23)),
];

const skipped = [
  { path: 'Ad_Targeting.csv', reason: 'Not a kind of record the import reads.' },
  { path: 'Inferences_about_you.csv', reason: 'Not a kind of record the import reads.' },
  { path: 'Jobs/Job Applications_1.csv', reason: '211 records read; 2 cells in Application Date were not a date.' },
  { path: 'Member_Follows.csv', reason: 'Not a kind of record the import reads.' },
  { path: 'Registration.csv', reason: 'Not a kind of record the import reads.' },
  { path: 'Rich_Media.csv', reason: 'Not a kind of record the import reads.' },
  { path: 'SearchQueries.csv', reason: 'Not a kind of record the import reads.' },
];

export const linkedInPlanFixture: LinkedInPlanView = {
  path: 'u1/0b6c-Basic_LinkedInDataExport_10-19-2026.zip',
  fileName: 'Basic_LinkedInDataExport_10-19-2026.zip',
  exportDate: '19 Oct',
  files: 41,
  kinds: rerunKinds,
  totals: total(rerunKinds),
  skipped,
};

export const linkedInRunsFixture: LinkedInRunView[] = [
  {
    id: 'run-2',
    ranOn: '12 Oct',
    exportDate: '11 Oct',
    status: 'applied',
    error: null,
    kinds: rerunKinds,
    totals: total(rerunKinds),
    skipped,
  },
  {
    id: 'run-1',
    ranOn: '28 Sep',
    exportDate: '27 Sep',
    status: 'applied',
    error: null,
    kinds: firstKinds,
    totals: total(firstKinds),
    skipped,
  },
  {
    id: 'run-0',
    ranOn: '28 Sep',
    exportDate: null,
    status: 'failed',
    error: 'The import stopped: Could not write the import: the connection was closed.',
    kinds: [kind('applications', c(371))],
    totals: c(371),
    skipped: [],
  },
];
