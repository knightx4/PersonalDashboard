import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { questionFingerprint } from '@/lib/jobs/fingerprint';
import { importLinkedIn } from '../linkedin';
import { memoryStore } from '../memory-store';
import { LINKEDIN_APPLICATION_MAPPERS, linkedInJobId, resumeNameKey } from './applications';

// The fixture export (lib/linkedin/archive/fixtures/build-export.ts) has three
// applications: Acme Robotics (job 4012345678, four answers), Globex (job
// 3999999999, none) and Initech (no URL, one answer), all with the resume
// "Sam Taylor CV.pdf", whose text is in Private_identity_asset.csv.

const zip = new Uint8Array(readFileSync(join(__dirname, '../../linkedin/archive/fixtures/export.zip')));
const mappers = LINKEDIN_APPLICATION_MAPPERS;
// Long after the fixture's one saved job, so only the applications become
// companies and roles here; saved.test.ts covers the saved job.
const archiveDate = '2026-12-01';

const COMPANIES = 'job_search.companies';
const ROLES = 'job_search.roles';
const APPS = 'job_search.applications';
const EVENTS = 'job_search.application_events';
const RESUMES = 'job_search.resume_versions';
const QUESTIONS = 'job_search.questions';
const ANSWERS = 'job_search.application_answers';

const SQL_Q = 'How many years of experience do you have with SQL?';
const RELOCATE_Q = 'Are you willing to relocate?';

describe('linkedInJobId', () => {
  it('reads the id from every URL shape LinkedIn uses', () => {
    expect(linkedInJobId('https://www.linkedin.com/jobs/view/4012345678')).toBe('4012345678');
    expect(linkedInJobId('https://www.linkedin.com/jobs/view/fp-a-associate-at-covet-health-4445415450/')).toBe('4445415450');
    expect(linkedInJobId('https://www.linkedin.com/jobs/search-results/?currentJobId=4472031139&keywords=jobs')).toBe('4472031139');
    expect(linkedInJobId('https://boards.greenhouse.io/acme/jobs/4012345678')).toBeNull();
    expect(linkedInJobId(null)).toBeNull();
  });

  it('compares resume names without extension or case', () => {
    expect(resumeNameKey('Sam Taylor CV.pdf')).toBe(resumeNameKey('sam taylor cv'));
  });
});

describe('importing LinkedIn applications', () => {
  it('adds each application as a submitted pursuit with its resume and answers, and a rerun adds nothing', async () => {
    const store = memoryStore();
    const once = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate });

    expect(store.rows(COMPANIES).map((c) => c.name).sort()).toEqual(['Acme Robotics', 'Globex', 'Initech']);
    const roles = store.rows(ROLES);
    expect(roles).toHaveLength(3);
    const acmeRole = roles.find((r) => r.title === 'Product Manager')!;
    expect(acmeRole).toMatchObject({ source: 'linkedin', ats_job_id: '4012345678', jd_url: 'https://www.linkedin.com/jobs/view/4012345678' });

    const [resume] = store.rows(RESUMES);
    expect(store.rows(RESUMES)).toHaveLength(1);
    expect(resume).toMatchObject({ label: 'Sam Taylor CV.pdf' });
    expect(String(resume.text_content)).toContain('Product Manager');

    const apps = store.rows(APPS);
    expect(apps).toHaveLength(3);
    for (const app of apps) expect(app).toMatchObject({ source: 'linkedin', resume_version_id: resume.id });
    const acmeApp = apps.find((a) => a.role_id === acmeRole.id)!;
    expect(acmeApp.submitted_at).toMatch(/^2026-06-1[34]T/);

    const events = store.rows(EVENTS);
    expect(events).toHaveLength(3);
    expect(events.find((e) => e.application_id === acmeApp.id)).toMatchObject({
      kind: 'submitted',
      source: 'system',
      occurred_at: acmeApp.submitted_at,
    });

    // The saved responses are the canonical answers; questions asked only in
    // an application have none.
    const questions = store.rows(QUESTIONS);
    expect(questions.find((q) => q.fingerprint === questionFingerprint(SQL_Q))).toMatchObject({ canonical_answer: '5' });
    const years = questions.find((q) => String(q.text).startsWith('How many years of product management'))!;
    expect(years.canonical_answer).toBeNull();

    const answers = store.rows(ANSWERS);
    expect(answers.length).toBeGreaterThanOrEqual(2);
    for (const a of answers) expect(a.status).toBe('submitted');
    expect(answers.find((a) => a.question_id === years.id)).toMatchObject({ application_id: acmeApp.id, answer: '6' });

    expect(once.plan.totals.skipped).toBe(0);

    const twice = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate });
    expect(twice.plan.totals.added).toBe(0);
    expect(twice.plan.totals.updated).toBe(0);
    expect(store.rows(APPS)).toHaveLength(3);
    expect(store.rows(EVENTS)).toHaveLength(3);
  });

  it('joins the roles, applications, resumes and questions already tracked rather than doubling them', async () => {
    const acmeCo = { id: '00000000-0000-4000-8000-000000000001', name: 'Acme Robotics, Inc.', slug: 'acme-robotics-inc', priority: 'target', domains: ['acme.example'] };
    const globexCo = { id: '00000000-0000-4000-8000-000000000002', name: 'Globex', slug: 'globex', priority: 'interested', domains: [] };
    // Acme's role was tracked from its LinkedIn posting, under another URL shape.
    const acmeRole = {
      id: '00000000-0000-4000-8000-000000000011',
      company_id: acmeCo.id,
      title: 'PM',
      jd_url: 'https://www.linkedin.com/jobs/view/product-manager-at-acme-robotics-4012345678/',
      ats_job_id: null,
      source: 'portal',
      posting_status: 'open',
      created_at: '2026-06-01T00:00:00Z',
    };
    // Globex's was tracked from mail with no job id, and has closed.
    const globexRole = {
      id: '00000000-0000-4000-8000-000000000012',
      company_id: globexCo.id,
      title: 'Senior Analyst',
      jd_url: null,
      ats_job_id: null,
      source: 'portal',
      posting_status: 'unknown',
      created_at: '2026-01-03T00:00:00Z',
    };
    const acmeApp = { id: '00000000-0000-4000-8000-000000000021', role_id: acmeRole.id, status: 'in_process', attempt: 1, submitted_at: null, source: 'portal', resume_version_id: null, created_at: '2026-06-14T00:00:00Z' };
    const globexApp = { id: '00000000-0000-4000-8000-000000000022', role_id: globexRole.id, status: 'rejected', attempt: 1, submitted_at: '2026-01-02T00:05:00Z', source: 'portal', resume_version_id: null, closed_at: '2026-02-01T00:00:00Z', created_at: '2026-01-03T00:00:00Z' };
    const globexSubmitted = { id: '00000000-0000-4000-8000-000000000031', application_id: globexApp.id, kind: 'submitted', occurred_at: '2026-01-02T00:05:00Z', source: 'email', summary: null };
    const resume = { id: '00000000-0000-4000-8000-000000000041', label: 'Sam Taylor CV', text_content: null, is_default: true };
    const sql = { id: '00000000-0000-4000-8000-000000000051', text: SQL_Q, fingerprint: questionFingerprint(SQL_Q), canonical_answer: 'Ten years' };
    const relocate = { id: '00000000-0000-4000-8000-000000000052', text: RELOCATE_Q, fingerprint: questionFingerprint(RELOCATE_Q), canonical_answer: null };

    const store = memoryStore({
      [COMPANIES]: [acmeCo, globexCo],
      [ROLES]: [acmeRole, globexRole],
      [APPS]: [acmeApp, globexApp],
      [EVENTS]: [globexSubmitted],
      [RESUMES]: [resume],
      [QUESTIONS]: [sql, relocate],
    });
    await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate });

    // Only Initech is new.
    expect(store.rows(COMPANIES)).toHaveLength(3);
    expect(store.rows(ROLES)).toHaveLength(3);
    expect(store.rows(APPS)).toHaveLength(3);
    expect(store.rows(RESUMES)).toHaveLength(1);

    // A joined row keeps what it had and gains only what was empty.
    expect(store.tables.get(ROLES)!.get(acmeRole.id)).toMatchObject({ title: 'PM', ats_job_id: '4012345678', source: 'portal' });
    expect(store.tables.get(APPS)!.get(acmeApp.id)).toMatchObject({ source: 'portal', resume_version_id: resume.id });
    expect(store.tables.get(APPS)!.get(acmeApp.id)!.submitted_at).toMatch(/^2026-06-1[34]T/);
    expect(store.tables.get(APPS)!.get(globexApp.id)).toMatchObject({ submitted_at: '2026-01-02T00:05:00Z' });
    expect(String(store.tables.get(RESUMES)!.get(resume.id)!.text_content)).toContain('Sam Taylor');

    // Globex's existing submitted event stands; the other two gain one.
    const events = store.rows(EVENTS);
    expect(events.filter((e) => e.application_id === globexApp.id)).toHaveLength(1);
    expect(events).toHaveLength(3);

    // A canonical answer the person has is kept; an empty one is filled.
    expect(store.tables.get(QUESTIONS)!.get(sql.id)).toMatchObject({ canonical_answer: 'Ten years' });
    expect(store.tables.get(QUESTIONS)!.get(relocate.id)).toMatchObject({ canonical_answer: 'No' });

    const again = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate });
    expect(again.plan.totals.added).toBe(0);
  });
});
