import { describe, expect, it } from 'vitest';
import {
  companyDomainQuery,
  companyLookbackQuery,
  companyLookbackVersion,
  incrementalFallbackQuery,
  recruitingCandidateQuery,
} from '@/lib/jobs/email/providers/gmail-query';

describe('recruitingCandidateQuery', () => {
  const query = recruitingCandidateQuery(90);

  it('covers the ATS senders and the application-shaped subjects', () => {
    expect(query).toContain('greenhouse.io');
    expect(query).toContain('calendly.com');
    expect(query).toContain('"thank you for applying"');
    expect(query).toContain('newer_than:90d');
  });

  it('does not exclude promotions, because a missed rejection is invisible', () => {
    expect(query).not.toContain('category:promotions');
  });

  it('clamps an absurd window rather than asking Gmail for everything', () => {
    expect(recruitingCandidateQuery(5)).toContain('newer_than:30d');
    expect(recruitingCandidateQuery(9999)).toContain('newer_than:730d');
  });
});

describe('companyDomainQuery', () => {
  it('builds the direct-outreach pass over tracked company domains', () => {
    expect(companyDomainQuery(['ramp.com', 'linear.app'], 90)).toBe(
      'newer_than:90d from:(ramp.com OR linear.app)',
    );
  });

  it('returns null rather than a query that matches everything', () => {
    expect(companyDomainQuery([], 90)).toBeNull();
    expect(companyDomainQuery(['  ', ''], 90)).toBeNull();
  });

  it('de-duplicates and caps the list', () => {
    const many = Array.from({ length: 100 }, (_, i) => `company${i}.com`);
    const query = companyDomainQuery([...many, 'company0.com'], 90)!;
    expect(query.split(' OR ')).toHaveLength(60);
  });
});

describe('incrementalFallbackQuery', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('widens to cover the gap since the last sync', () => {
    expect(incrementalFallbackQuery('2026-04-01T00:00:00Z', now)).toContain('newer_than:30d');
  });

  it('does not shrink below the floor for a very recent sync', () => {
    expect(incrementalFallbackQuery('2026-04-14T00:00:00Z', now)).toContain('newer_than:30d');
  });
});

describe('the subjects a company sends from its own address', () => {
  it('lists "thanks for your interest", which the Keystone acknowledgement needed', () => {
    const query = recruitingCandidateQuery(180);
    expect(query).toContain('"thanks for your interest"');
    expect(query).toContain('"thank you for your interest"');
    expect(query).toContain('"applying"');
  });
});

describe('companyLookbackQuery', () => {
  it('searches the company its own domains', () => {
    expect(companyLookbackQuery(['keystone.com'], 180)).toBe('newer_than:180d from:(keystone.com)');
  });

  it('leaves out domains many senders share', () => {
    expect(
      companyLookbackQuery(['jobs.ashbyhq.com', 'gmail.com', 'match.indeed.com', 'ramp.com'], 180),
    ).toBe('newer_than:180d from:(ramp.com)');
  });

  it('returns null when nothing is left to search', () => {
    expect(companyLookbackQuery(['jobs.lever.co', 'job-boards.greenhouse.io'], 180)).toBeNull();
    expect(companyLookbackQuery([], 180)).toBeNull();
  });
});

describe('companyLookbackVersion', () => {
  it('ignores order and case', () => {
    expect(companyLookbackVersion(['b.com', 'A.com'])).toBe(companyLookbackVersion(['a.com', 'b.com']));
  });

  it('changes when a domain is added', () => {
    expect(companyLookbackVersion(['a.com', 'b.com'])).not.toBe(companyLookbackVersion(['a.com']));
  });

  it('fits a positive Postgres integer', () => {
    for (const domains of [[], ['a.com'], ['keystone.com', 'keystonestrategy.com']]) {
      const version = companyLookbackVersion(domains);
      expect(version).toBeGreaterThan(0);
      expect(version).toBeLessThanOrEqual(2_147_483_647);
    }
  });
});
