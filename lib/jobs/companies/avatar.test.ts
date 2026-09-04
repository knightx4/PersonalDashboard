import { describe, expect, it } from 'vitest';
import {
  companyAvatarSrc,
  companyDomain,
  companyInitials,
  faviconUrl,
  isOwnDomain,
} from './avatar';

describe('isOwnDomain', () => {
  it('accepts a company domain', () => {
    expect(isOwnDomain('ramp.com')).toBe(true);
    expect(isOwnDomain('jobs.ramp.com')).toBe(true);
  });

  it('rejects the ATS the company recruits through', () => {
    expect(isOwnDomain('boards.greenhouse.io')).toBe(false);
    expect(isOwnDomain('jobs.lever.co')).toBe(false);
    expect(isOwnDomain('jobs.ashbyhq.com')).toBe(false);
    expect(isOwnDomain('acme.bamboohr.com')).toBe(false);
  });

  it('rejects the aggregators a lead can arrive from', () => {
    expect(isOwnDomain('linkedin.com')).toBe(false);
    expect(isOwnDomain('indeed.com')).toBe(false);
    expect(isOwnDomain('wellfound.com')).toBe(false);
  });

  it('rejects junk that is not a host at all', () => {
    expect(isOwnDomain('')).toBe(false);
    expect(isOwnDomain('acme')).toBe(false);
  });
});

describe('companyDomain', () => {
  it('prefers the website over the accumulated domain list', () => {
    expect(
      companyDomain({
        name: 'Ramp',
        website: 'https://ramp.com/about',
        domains: ['mail.ramp.com'],
      }),
    ).toBe('ramp.com');
  });

  it('skips ATS hosts in the domain list', () => {
    expect(
      companyDomain({ name: 'Acme', domains: ['boards.greenhouse.io', 'acme.com'] }),
    ).toBe('acme.com');
  });

  it('falls back to a careers subdomain when nothing else is left', () => {
    expect(
      companyDomain({ name: 'Ramp', domains: [], careersUrl: 'https://jobs.ramp.com/openings' }),
    ).toBe('jobs.ramp.com');
  });

  it('is null when every domain we hold belongs to an ATS', () => {
    expect(
      companyDomain({ name: 'Acme', domains: ['job-boards.greenhouse.io'], careersUrl: 'https://jobs.lever.co/acme' }),
    ).toBeNull();
  });

  it('strips www', () => {
    expect(companyDomain({ name: 'Acme', domains: ['www.acme.com'] })).toBe('acme.com');
  });
});

describe('companyAvatarSrc', () => {
  it('uses a stored logo before anything else', () => {
    expect(
      companyAvatarSrc({
        name: 'Ramp',
        logoUrl: 'https://ramp.com/apple-touch-icon.png',
        domains: ['ramp.com'],
      }),
    ).toBe('https://ramp.com/apple-touch-icon.png');
  });

  it('falls back to a favicon for the company domain', () => {
    expect(companyAvatarSrc({ name: 'Ramp', domains: ['ramp.com'] })).toContain('domain=ramp.com');
  });

  it('returns null with the favicon service turned off', () => {
    expect(companyAvatarSrc({ name: 'Ramp', domains: ['ramp.com'] }, { favicons: false })).toBeNull();
  });

  it('returns null when there is no logo and no domain of the company own', () => {
    expect(companyAvatarSrc({ name: 'Acme', domains: ['jobs.lever.co'] })).toBeNull();
  });

  it('ignores a blank stored logo', () => {
    expect(companyAvatarSrc({ name: 'Acme', logoUrl: '   ', domains: [] })).toBeNull();
  });
});

describe('faviconUrl', () => {
  it('builds a keyless favicon URL', () => {
    expect(faviconUrl('www.Acme.com')).toBe(
      'https://www.google.com/s2/favicons?domain=acme.com&sz=128',
    );
  });
});

describe('companyInitials', () => {
  it('uses two letters from multi-word names', () => {
    expect(companyInitials('Hill Country Robotics')).toBe('HC');
  });

  it('uses two letters from a single word', () => {
    expect(companyInitials('Ramp')).toBe('RA');
  });

  it('has something to show for an empty name', () => {
    expect(companyInitials('  ')).toBe('?');
  });
});
