import { describe, expect, it } from 'vitest';
import { originFromCompSource, roleFactOrigins, toFactOrigin } from './fact-origins';

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
