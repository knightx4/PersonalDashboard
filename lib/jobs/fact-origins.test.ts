import { describe, expect, it } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { AppSupabaseClient } from './db/schema-name';
import {
  changedRoleFacts,
  mayReplace,
  originFromCompSource,
  recordHandEditOrigins,
  recordRoleFactOrigins,
  roleFactOrigins,
  toFactOrigin,
} from './fact-origins';

const ME = '00000000-0000-4000-8000-0000000000aa';
const SOMEONE = '00000000-0000-4000-8000-0000000000bb';
const ROLE = '11111111-1111-4111-8111-111111111111';

const db = (tables: FakeTables) => fakeSchemaDb(tables)('job_search') as unknown as AppSupabaseClient;
const origins = (tables: FakeTables) => tables['job_search.fact_origins'] ?? [];
const originOf = (tables: FakeTables, field: string) => origins(tables).find((row) => row.role_id === ROLE && row.field === field);

describe('mayReplace', () => {
  it('lets a write replace an origin only when it is at least as certain', () => {
    expect(mayReplace(null, 'guess')).toBe(true);
    expect(mayReplace({ origin: 'unknown', certainty: null }, 'guess')).toBe(true);
    expect(mayReplace({ origin: 'posting', certainty: 'firsthand' }, 'guess')).toBe(false);
    expect(mayReplace({ origin: 'posting', certainty: 'firsthand' }, 'secondhand')).toBe(false);
    expect(mayReplace({ origin: 'recruiter_email', certainty: 'secondhand' }, 'secondhand')).toBe(true);
    expect(mayReplace({ origin: 'dash', certainty: 'guess' }, 'firsthand')).toBe(true);
  });
});

describe('changedRoleFacts', () => {
  it('names only the facts whose value moved, pay as one', () => {
    const before = { location: 'London', work_mode: null, seniority: 'Senior', posting_status: 'open', comp_min_cents: 1, comp_max_cents: 2, comp_source: 'posted' };
    expect(
      changedRoleFacts(before, { location: 'London', work_mode: 'remote', seniority: '', comp_min_cents: 1, comp_max_cents: 3, comp_source: 'posted', title: 'x' }),
    ).toEqual([
      { field: 'work_mode', cleared: false },
      { field: 'seniority', cleared: true },
      { field: 'comp', cleared: false },
    ]);
    expect(changedRoleFacts(before, { posting_status: 'unknown', comp_min_cents: null, comp_max_cents: null })).toEqual([
      { field: 'posting_status', cleared: true },
      { field: 'comp', cleared: true },
    ]);
  });
});

describe('recordRoleFactOrigins', () => {
  it('inserts, replaces, keeps a more certain origin and drops the row of an emptied fact', async () => {
    const t: FakeTables = {
      'job_search.fact_origins': [
        { id: 'o1', user_id: ME, role_id: ROLE, field: 'comp', origin: 'posting', certainty: 'firsthand' },
        { id: 'o2', user_id: ME, role_id: ROLE, field: 'location', origin: 'unknown', certainty: null },
        { id: 'o3', user_id: ME, role_id: ROLE, field: 'seniority', origin: 'dash', certainty: 'guess' },
      ],
    };
    const guess = { origin: 'dash', certainty: 'guess' } as const;
    const out = await recordRoleFactOrigins(db(t), ME, ROLE, [
      { field: 'comp', source: guess },
      { field: 'location', source: guess },
      { field: 'work_mode', source: { origin: 'posting', certainty: 'firsthand', sourceUrl: 'https://jobs.example/1' } },
      { field: 'seniority', cleared: true },
    ]);
    expect(out).toEqual({ recorded: ['location', 'work_mode', 'seniority'], kept: ['comp'] });
    expect(originOf(t, 'comp')).toMatchObject({ origin: 'posting', certainty: 'firsthand' });
    expect(originOf(t, 'location')).toMatchObject({ origin: 'dash', certainty: 'guess' });
    expect(originOf(t, 'work_mode')).toMatchObject({ user_id: ME, origin: 'posting', certainty: 'firsthand', source_url: 'https://jobs.example/1' });
    expect(originOf(t, 'seniority')).toBeUndefined();
  });

  it('touches no other account', async () => {
    const t: FakeTables = {
      'job_search.fact_origins': [{ id: 'o1', user_id: SOMEONE, role_id: ROLE, field: 'location', origin: 'you', certainty: 'firsthand' }],
    };
    await recordRoleFactOrigins(db(t), ME, ROLE, [{ field: 'location', cleared: true }]);
    expect(origins(t)).toHaveLength(1);
  });
});

describe('recordHandEditOrigins', () => {
  it('records the person firsthand over a posted fact, and pay with the source they picked', async () => {
    const t: FakeTables = {
      'job_search.fact_origins': [{ id: 'o1', user_id: ME, role_id: ROLE, field: 'location', origin: 'posting', certainty: 'firsthand' }],
    };
    const before = { location: 'London', work_mode: null, seniority: null, posting_status: 'open', comp_min_cents: null, comp_max_cents: null, comp_source: null };
    await recordHandEditOrigins(db(t), ME, ROLE, before, { location: 'Paris', comp_min_cents: 100, comp_max_cents: 200, comp_source: 'recruiter' });
    expect(originOf(t, 'location')).toMatchObject({ origin: 'you', certainty: 'firsthand' });
    expect(originOf(t, 'comp')).toMatchObject({ origin: 'you', certainty: 'secondhand' });
  });

  it('records nothing for a save that changed no fact, and the posting for pay read from a pasted description', async () => {
    const t: FakeTables = {
      'job_search.fact_origins': [{ id: 'o1', user_id: ME, role_id: ROLE, field: 'comp', origin: 'posting', certainty: 'firsthand' }],
    };
    const before = { comp_min_cents: 100, comp_max_cents: 200, comp_source: 'posted' };
    await recordHandEditOrigins(db(t), ME, ROLE, before, { jd_url: 'https://x', comp_min_cents: 100, comp_max_cents: 200, comp_source: 'posted' });
    expect(originOf(t, 'comp')).toMatchObject({ origin: 'posting' });
    await recordHandEditOrigins(db(t), ME, ROLE, before, { comp_min_cents: 300, comp_max_cents: 400, comp_source: 'posted' }, { payFromPosting: true });
    expect(originOf(t, 'comp')).toMatchObject({ origin: 'posting', certainty: 'firsthand' });
  });
});

describe('roleFactOrigins', () => {
  it('returns every field, null where nothing is recorded', () => {
    const out = roleFactOrigins([]);
    expect(Object.keys(out).sort()).toEqual(['comp', 'location', 'posting_status', 'seniority', 'stage', 'work_mode']);
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it('reads role rows for role fields and company rows for the stage', () => {
    const out = roleFactOrigins([
      { role_id: 'r', field: 'comp', origin: 'posting', certainty: 'firsthand', recorded_at: '2026-10-18T00:00:00Z' },
      { company_id: 'c', field: 'stage', origin: 'unknown', certainty: null, recorded_at: '2026-10-18T00:00:00Z' },
      { company_id: 'c', field: 'location', origin: 'you', certainty: 'firsthand', recorded_at: 'x' },
    ]);
    expect(out.comp).toMatchObject({ origin: 'posting', certainty: 'firsthand' });
    expect(out.stage).toMatchObject({ origin: 'unknown', certainty: null });
    expect(out.location).toBeNull();
  });
});

describe('toFactOrigin', () => {
  it('drops a field or origin it does not know', () => {
    expect(toFactOrigin({ field: 'title', origin: 'you', certainty: 'firsthand' })).toBeNull();
    expect(toFactOrigin({ field: 'comp', origin: 'rumour', certainty: 'guess' })).toBeNull();
  });

  it('keeps certainty null for an unknown origin', () => {
    expect(toFactOrigin({ field: 'comp', origin: 'unknown', certainty: 'guess' })?.certainty).toBeNull();
  });
});

describe('originFromCompSource', () => {
  it('maps as the backfill did', () => {
    expect(originFromCompSource('posted')).toEqual({ origin: 'posting', certainty: 'firsthand' });
    expect(originFromCompSource('recruiter')).toEqual({ origin: 'recruiter_email', certainty: 'secondhand' });
    expect(originFromCompSource('estimate')).toEqual({ origin: 'dash', certainty: 'guess' });
    expect(originFromCompSource(null)).toEqual({ origin: 'unknown', certainty: null });
  });
});
