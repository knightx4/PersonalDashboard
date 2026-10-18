import { describe, expect, it } from 'vitest';
import { applyBoardToRole, PLACEHOLDER_TITLE, type RoleForLookup } from './lookup';
import { PLACEHOLDER_ROLE_TITLE } from '@/lib/jobs/inbox/ingest-messages';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../../tests/stubs/fake-schema-db';

const ME = '00000000-0000-4000-8000-0000000000aa';
const ROLE = '11111111-1111-4111-8111-111111111111';

describe('reading a posting off the board (plan #2343.2)', () => {
  const role: RoleForLookup = {
    id: ROLE,
    user_id: ME,
    title: 'Senior Data Engineer',
    ats_job_id: null,
    location: 'London',
    work_mode: null,
    seniority: null,
    comp_min_cents: null,
    comp_max_cents: null,
    jd_url: null,
    posting_status: 'unknown',
  };
  const posting = {
    vendor: 'greenhouse',
    title: 'Senior Data Engineer',
    text: 'We build data tools. This role is fully remote.\nThe salary range for this role is $150,000 - $180,000 per year.',
    url: 'https://boards.example/acme/1',
    location: 'Remote',
    atsJobId: '1',
    boardToken: 'acme',
    questions: [],
  };

  it('records the facts it fills as from the posting, firsthand, and leaves a fact it did not write alone', async () => {
    const t: FakeTables = {
      'job_search.roles': [{ ...role }],
      'job_search.fact_origins': [{ id: 'o1', user_id: ME, role_id: ROLE, field: 'location', origin: 'you', certainty: 'firsthand' }],
    };
    const db = fakeSchemaDb(t)('job_search') as unknown as AppSupabaseClient;
    const out = await applyBoardToRole(db, role, { vendor: 'greenhouse', token: 'acme', postings: [posting], trust: 'known' }, new Date('2026-10-18T00:00:00Z'));
    expect(out.kind).toBe('filled');
    const origin = (field: string) => t['job_search.fact_origins'].find((row) => row.field === field);
    for (const field of ['comp', 'work_mode', 'seniority', 'posting_status']) {
      expect(origin(field)).toMatchObject({ user_id: ME, role_id: ROLE, origin: 'posting', certainty: 'firsthand', source_url: posting.url });
    }
    expect(origin('location')).toMatchObject({ origin: 'you' });
  });
});

/**
 * The placeholder title is written by ingestion and read by the lookup, and the
 * two hold it separately: importing the constant from the inbox module would
 * pull the whole ingestion pipeline — the Gmail client, the model SDK — into a
 * server action whose job is to render a button.
 *
 * That is a defensible trade only while this test exists. If the two drift, the
 * lookup silently starts treating "Role from email" as a real job title, offers
 * it to board discovery as evidence, and confirms a guessed board against a
 * title no employer ever posted.
 */
describe('the placeholder title', () => {
  it('is the same string ingestion writes', () => {
    expect(PLACEHOLDER_TITLE).toBe(PLACEHOLDER_ROLE_TITLE);
  });
});
