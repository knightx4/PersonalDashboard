import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLinkedInArchive, type LinkedInArchive } from '@/lib/linkedin/archive';
import { applyPlan, planImport } from '../engine';
import { importLinkedIn, LINKEDIN_MAPPERS, LINKEDIN_SOURCE } from '../linkedin';
import { memoryStore, type MemoryStore } from '../memory-store';
import { FOLLOW_REASON, linkedInPreferences } from './saved';
import { exportDay, savedJobSkip } from './saved-window';

// The fixture export (lib/linkedin/archive/fixtures/build-export.ts) saved one
// job, Head of Product at Umbrella Health (job 4087654321) on 21 August 2026;
// follows Acme Robotics, which it also applied to; and prefers "Denver,
// Colorado | Remote" for "Product Manager | Product Lead", with one alert for
// product manager jobs in Denver.

const zip = new Uint8Array(readFileSync(join(__dirname, '../../linkedin/archive/fixtures/export.zip')));
const mappers = LINKEDIN_MAPPERS;

const COMPANIES = 'job_search.companies';
const ROLES = 'job_search.roles';
const APPS = 'job_search.applications';
const EVENTS = 'job_search.application_events';
const WATCHLIST = 'job_search.watchlist_startups';
const PROFILES = 'job_search.profiles';

const ME = '00000000-0000-4000-8000-000000000001';

function profile(values: Record<string, unknown> = {}) {
  return { id: ME, pipeline_view: 'board', target_titles: [], home_location: null, workplace_preferences: [], ...values };
}

/** The fixture archive with its follows replaced, for the watchlist cases. */
function withFollows(...organizations: string[]): LinkedInArchive {
  const archive = readLinkedInArchive(zip);
  archive.exportedOn = '2026-09-01';
  archive.companyFollows = organizations.map((organization) => ({
    key: organization.toLowerCase(),
    file: 'Company Follows.csv',
    organization,
    followedAt: '2026-08-01T00:00:00.000Z',
  }));
  return archive;
}

async function run(store: MemoryStore, archive: LinkedInArchive) {
  const plan = await planImport(store, LINKEDIN_SOURCE, mappers, archive);
  await applyPlan(store, plan);
  return plan;
}

const kind = (plan: Awaited<ReturnType<typeof run>>, name: string) => plan.kinds.find((k) => k.kind === name)!;

describe('the saved-job window', () => {
  it('measures against the export day, else the latest date in the export', () => {
    const archive = readLinkedInArchive(zip);
    expect(exportDay({ ...archive, exportedOn: '2026-10-19' })).toBe('2026-10-19');
    expect(exportDay(archive)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [job] = archive.savedJobs;
    expect(savedJobSkip(job, '2026-09-01')).toBeNull();
    expect(savedJobSkip(job, '2026-10-19')).toMatch(/more than 30 days/);
    expect(savedJobSkip({ ...job, savedAt: null }, '2026-09-01')).toMatch(/no saved date/);
  });
});

describe('importing saved jobs', () => {
  it('makes a recent saved job a lead on a new role, and a rerun adds nothing', async () => {
    const store = memoryStore({ [PROFILES]: [profile()] });
    const once = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });

    expect(store.rows(COMPANIES).map((c) => c.name).sort()).toEqual(['Acme Robotics', 'Globex', 'Initech', 'Umbrella Health']);
    const role = store.rows(ROLES).find((r) => r.title === 'Head of Product')!;
    expect(role).toMatchObject({ source: 'linkedin', ats_job_id: '4087654321' });
    const lead = store.rows(APPS).find((a) => a.role_id === role.id)!;
    // Status is left to the column's default, lead; no submitted date or event.
    expect(lead).toEqual({ id: lead.id, role_id: role.id, source: 'linkedin' });
    expect(store.rows(EVENTS).some((e) => e.application_id === lead.id)).toBe(false);
    expect(kind(once.plan, 'leads').counts).toMatchObject({ added: 1, skipped: 0 });

    const twice = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });
    expect(twice.plan.totals.added).toBe(0);
    expect(twice.plan.totals.updated).toBe(0);
    expect(store.rows(APPS)).toHaveLength(4);
  });

  it('skips a saved job older than 30 days, and adds neither its company nor its role', async () => {
    const store = memoryStore({ [PROFILES]: [profile()] });
    const { plan } = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-10-19' });
    const leads = kind(plan, 'leads');
    expect(leads.counts).toMatchObject({ added: 0, skipped: 1 });
    expect(leads.records[0].reason).toMatch(/more than 30 days/);
    expect(store.rows(COMPANIES).map((c) => c.name)).not.toContain('Umbrella Health');
    expect(store.rows(ROLES).map((r) => r.title)).not.toContain('Head of Product');
  });

  it('joins a saved job already tracked, adding no second application', async () => {
    const store = memoryStore({
      [PROFILES]: [profile()],
      [COMPANIES]: [{ id: 'c1', name: 'Umbrella Health', slug: 'umbrella-health', priority: 'target', domains: [] }],
      [ROLES]: [{ id: 'r1', company_id: 'c1', title: 'Head of Product', ats_job_id: '4087654321', posting_status: 'open', created_at: '2026-08-01' }],
      [APPS]: [{ id: 'a1', role_id: 'r1', status: 'drafting', attempt: 1, closed_at: null, source: 'portal', created_at: '2026-08-01' }],
    });
    const { plan } = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });
    expect(store.rows(APPS).filter((a) => a.role_id === 'r1')).toHaveLength(1);
    expect(store.rows(APPS).find((a) => a.id === 'a1')).toMatchObject({ status: 'drafting', source: 'portal' });
    expect(kind(plan, 'leads').records[0]).toMatchObject({ outcome: 'unchanged', rowId: 'a1' });
  });
});

describe('importing followed companies', () => {
  it('puts an untracked company on the watchlist with source linkedin', async () => {
    const store = memoryStore({ [PROFILES]: [profile()] });
    const plan = await run(store, withFollows('Hooli'));
    expect(store.rows(WATCHLIST)).toEqual([
      expect.objectContaining({ name: 'Hooli', name_key: 'hooli', source: 'linkedin', reason: FOLLOW_REASON }),
    ]);
    // Never a companies row.
    expect(store.rows(COMPANIES).map((c) => c.name)).not.toContain('Hooli');
    expect(kind(plan, 'companies').records.find((r) => r.key === 'hooli')).toMatchObject({ outcome: 'skipped' });

    const again = await run(store, withFollows('Hooli'));
    expect(kind(again, 'watchlist').counts).toMatchObject({ added: 0, unchanged: 1 });
    expect(store.rows(WATCHLIST)).toHaveLength(1);
  });

  it('links a followed company the person tracks, and leaves the watchlist alone', async () => {
    const store = memoryStore({
      [PROFILES]: [profile()],
      [COMPANIES]: [{ id: 'c9', name: 'Hooli Inc.', slug: 'hooli-inc', priority: 'interested', domains: [] }],
    });
    const plan = await run(store, withFollows('Hooli'));
    expect(store.rows(WATCHLIST)).toEqual([]);
    expect(kind(plan, 'companies').records.find((r) => r.key === 'hooli')).toMatchObject({ rowId: 'c9' });
    expect(kind(plan, 'watchlist').records[0]).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/your companies/) });
    expect(store.rows(COMPANIES).find((c) => c.id === 'c9')).toMatchObject({ name: 'Hooli Inc.' });
  });

  it('joins a startup discovery already put on the watchlist', async () => {
    const store = memoryStore({
      [PROFILES]: [profile()],
      [WATCHLIST]: [{ id: 'w1', name: 'Hooli', name_key: 'hooli', source: 'yc', reason: 'Fits your aims.' }],
    });
    await run(store, withFollows('Hooli'));
    expect(store.rows(WATCHLIST)).toEqual([expect.objectContaining({ id: 'w1', source: 'yc', reason: 'Fits your aims.' })]);
  });

  it('adds nothing for a followed company the export applied to', async () => {
    const store = memoryStore({ [PROFILES]: [profile()] });
    const { plan } = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });
    expect(store.rows(WATCHLIST)).toEqual([]);
    expect(store.rows(COMPANIES).filter((c) => c.name === 'Acme Robotics')).toHaveLength(1);
    expect(kind(plan, 'watchlist').counts).toMatchObject({ skipped: 1 });
  });
});

describe('importing job preferences', () => {
  it('reads titles, home and workplace from the preferences, and the alerts only for what is missing', () => {
    const archive = readLinkedInArchive(zip);
    expect(linkedInPreferences(archive)).toEqual({
      targetTitles: ['Product Manager', 'Product Lead'],
      homeLocation: 'Denver, Colorado',
      workplace: ['remote'],
    });
    const alertsOnly: LinkedInArchive = {
      ...archive,
      jobSeekerPreferences: [],
      savedJobAlerts: [{ ...archive.savedJobAlerts[0], parameters: 'keywords=Chief%20of%20Staff&location=Austin&f_WT=2,3' }],
    };
    expect(linkedInPreferences(alertsOnly)).toEqual({
      targetTitles: ['Chief of Staff'],
      homeLocation: 'Austin',
      workplace: ['remote', 'hybrid'],
    });
  });

  it('fills only the empty preferences and keeps what the person set, on every run', async () => {
    const store = memoryStore({ [PROFILES]: [profile({ target_titles: ['Strategic Finance'] })] });
    const { plan } = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });
    expect(store.rows(PROFILES)[0]).toMatchObject({
      target_titles: ['Strategic Finance'],
      home_location: 'Denver, Colorado',
      workplace_preferences: ['remote'],
    });
    expect(kind(plan, 'preferences').records[0]).toMatchObject({ outcome: 'updated', changed: ['home_location', 'workplace_preferences'] });

    const again = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });
    expect(kind(again.plan, 'preferences').records[0].outcome).toBe('kept');
    expect(store.rows(PROFILES)[0].target_titles).toEqual(['Strategic Finance']);
  });

  it('fills an empty profile whole, and a rerun leaves it unchanged', async () => {
    const store = memoryStore({ [PROFILES]: [profile()] });
    await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });
    expect(store.rows(PROFILES)[0].target_titles).toEqual(['Product Manager', 'Product Lead']);
    const again = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });
    expect(kind(again.plan, 'preferences').records[0].outcome).toBe('unchanged');
  });

  it('adds no profile when the person has none', async () => {
    const store = memoryStore();
    const { plan } = await importLinkedIn(store, zip, { dryRun: false, mappers, archiveDate: '2026-09-01' });
    expect(store.rows(PROFILES)).toEqual([]);
    expect(kind(plan, 'preferences').records[0]).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/no Jobs profile/) });
  });
});
