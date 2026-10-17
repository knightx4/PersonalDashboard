import { describe, expect, it } from 'vitest';
import { NO_PREFERENCES } from '@/lib/jobs/suggest/preferences';
import { companyPlaceFits, onCompanies } from './watchlist-load';

describe('companyPlaceFits', () => {
  const nyc = { ...NO_PREFERENCES, homeLocation: 'New York City' };

  it('keeps New York companies and drops the rest once a home location is set', () => {
    expect(companyPlaceFits({ locations: ['New York City, NY, USA'] }, nyc)).toBe(true);
    expect(companyPlaceFits({ locations: ['San Francisco, CA, USA'] }, nyc)).toBe(false);
    expect(companyPlaceFits({ locations: ['London, England, United Kingdom'] }, nyc)).toBe(false);
    expect(companyPlaceFits({ locations: ['ONSITE San Francisco, CA'] }, nyc)).toBe(false);
  });

  it('keeps a company that names no place, and every company when no home is set', () => {
    expect(companyPlaceFits({ locations: [] }, nyc)).toBe(true);
    expect(companyPlaceFits({ locations: ['San Francisco, CA, USA'] }, NO_PREFERENCES)).toBe(true);
  });
});

describe('onCompanies', () => {
  const row = { companyId: null, name: 'Tallow', website: 'https://tallow.dev', vendor: null, token: null };

  it('is true for a row Add to my companies linked (note 62b88f19)', () => {
    expect(onCompanies({ ...row, companyId: '3c1f6a2e-0000-4000-8000-000000000001' }, [])).toBe(true);
  });

  it('is true for the same company added another way, by name or domain', () => {
    expect(onCompanies(row, [{ name: 'Tallow', domains: [], website: null }])).toBe(true);
    expect(onCompanies({ ...row, name: 'Tallow Labs' }, [{ name: 'Tallow Inc', domains: ['tallow.dev'], website: null }])).toBe(true);
  });

  it('is false for a company not on the list', () => {
    expect(onCompanies(row, [{ name: 'Kestrel Bank', domains: ['kestrel.com'], website: null }])).toBe(false);
  });
});
