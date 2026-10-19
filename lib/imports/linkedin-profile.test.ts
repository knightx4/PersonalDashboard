import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importLinkedIn } from './linkedin';
import { LINKEDIN_PROFILE_MAPPERS, monthDate } from './linkedin-profile';
import { memoryStore } from './memory-store';

const zip = new Uint8Array(readFileSync(join(__dirname, '../linkedin/archive/fixtures/export.zip')));
const WORK = 'you.work_history';
const PROFILE = 'you.profile_entries';

// Two jobs already on the tab: Hooli read from the résumé with a note, and a
// job added by hand that LinkedIn does not list.
const hooli = {
  id: '00000000-0000-4000-8000-000000000001',
  employer: 'Hooli, Inc.',
  title: 'Product Manager',
  place: null,
  started: '2025-07',
  ended: null,
  note: 'Ran payments.',
  source: null,
  edited: false,
};
const shop = {
  id: '00000000-0000-4000-8000-000000000002',
  employer: 'Corner bookshop',
  title: null,
  place: null,
  started: '2014',
  ended: '2016',
  note: null,
  source: null,
  edited: true,
};
const onTranscript = { id: '00000000-0000-4000-8000-000000000010', code: 'ECON301', title: 'Intro to Econometrics' };

function seeded() {
  return memoryStore({ [WORK]: [hooli, shop], 'you.courses': [onTranscript] });
}

const run = (store: ReturnType<typeof memoryStore>) =>
  importLinkedIn(store, zip, { dryRun: false, mappers: LINKEDIN_PROFILE_MAPPERS });

describe('the LinkedIn profile import', () => {
  it('reads partial dates as the tables keep them', () => {
    expect(monthDate('2025-07')).toBe('2025-07');
    expect(monthDate('2016')).toBe('2016');
    expect(monthDate('2026-08-21')).toBe('2026-08');
    expect(monthDate('soon')).toBeNull();
    expect(monthDate(null)).toBeNull();
  });

  it('joins the jobs already there, adds the rest and lists the profile by kind', async () => {
    const store = seeded();
    const { plan } = await run(store);
    const counts = Object.fromEntries(plan.kinds.map((k) => [k.kind, k.counts]));

    // Hooli joins the résumé's row; Initrode is new.
    expect(counts.positions).toMatchObject({ added: 1, updated: 1 });
    const jobs = store.rows(WORK);
    expect(jobs).toHaveLength(3);
    const joined = jobs.find((j) => j.id === hooli.id)!;
    // Only its empty columns are filled: the note it had stays, and it is marked as LinkedIn's.
    expect(joined).toMatchObject({ employer: 'Hooli, Inc.', note: 'Ran payments.', place: 'Denver, Colorado', source: 'linkedin' });
    expect(store.tables.get(WORK)!.get(shop.id)).toEqual(shop);
    expect(jobs.find((j) => j.employer === 'Initrode')).toMatchObject({
      title: 'Analyst',
      started: '2016',
      ended: '2025-06',
      note: null,
      source: 'linkedin',
    });

    const entries = store.rows(PROFILE);
    const byKind = (kind: string) => entries.filter((e) => e.kind === kind);
    expect(byKind('school')).toEqual([
      expect.objectContaining({ name: 'State University', detail: 'BSc Economics', started: '2012', ended: '2016', activities: 'Debate' }),
    ]);
    expect(byKind('certification')).toEqual([
      expect.objectContaining({
        name: 'Certified Scrum Product Owner',
        detail: 'Scrum Alliance',
        started: '2024-03',
        ended: '2026-03',
        code: 'CSPO-123',
        url: 'https://example.com/cert/1',
      }),
    ]);
    expect(byKind('honor')).toEqual([expect.objectContaining({ name: "Dean's List", description: 'Top 5%', started: '2015-12' })]);
    expect(byKind('skill').map((s) => s.name)).toEqual(['Product Management', 'SQL']);
  });

  it('leaves a course already on a transcript alone', async () => {
    const store = seeded();
    const { plan } = await run(store);
    expect(plan.kinds.find((k) => k.kind === 'courses')!.records).toEqual([
      expect.objectContaining({ outcome: 'skipped', reason: 'It is already on one of your transcripts.' }),
    ]);
    expect(store.rows(PROFILE).filter((e) => e.kind === 'course')).toEqual([]);
    expect(store.rows('you.courses')).toEqual([onTranscript]);

    // With no transcript, the course is listed with its number.
    const bare = memoryStore();
    await run(bare);
    expect(bare.rows(PROFILE).filter((e) => e.kind === 'course')).toEqual([
      expect.objectContaining({ name: 'Econometrics', code: 'ECON 301' }),
    ]);
  });

  it('adds nothing twice on a rerun and keeps what the person changed', async () => {
    const store = seeded();
    await run(store);
    const jobs = store.rows(WORK).length;
    const entries = store.rows(PROFILE).length;

    const skill = store.rows(PROFILE).find((e) => e.name === 'SQL')!;
    store.edit(PROFILE, String(skill.id), { name: 'PostgreSQL' });

    const again = await run(store);
    expect(again.plan.totals.added).toBe(0);
    expect(store.rows(WORK)).toHaveLength(jobs);
    expect(store.rows(PROFILE)).toHaveLength(entries);
    expect(again.plan.kinds.find((k) => k.kind === 'skills')!.counts).toMatchObject({ kept: 1, unchanged: 1 });
    expect(store.tables.get(PROFILE)!.get(String(skill.id))).toMatchObject({ name: 'PostgreSQL' });
  });
});
