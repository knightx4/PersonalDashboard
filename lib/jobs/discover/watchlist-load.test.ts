import { describe, expect, it } from 'vitest';
import { NO_PREFERENCES } from '@/lib/jobs/suggest/preferences';
import { companyPlaceFits } from './watchlist-load';

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
