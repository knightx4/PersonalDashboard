import { describe, expect, it } from 'vitest';
import {
  companyNameKey,
  duplicatePairs,
  employerDomain,
  findSameCompany,
  isSharedHost,
  sameCompany,
} from './same-company';

describe('isSharedHost', () => {
  it('knows the boards and job sites', () => {
    expect(isSharedHost('jobs.ashbyhq.com')).toBe(true);
    expect(isSharedHost('job-boards.greenhouse.io')).toBe(true);
    expect(isSharedHost('citi.wd5.myworkdayjobs.com')).toBe(true);
    expect(isSharedHost('builtinnyc.com')).toBe(true);
    expect(isSharedHost('send.dover.com')).toBe(true);
  });

  it('leaves an employer domain alone', () => {
    expect(isSharedHost('herondata.io')).toBe(false);
    expect(isSharedHost('jobs.bendingspoons.com')).toBe(false);
  });

  it('lets a board that is the employer keep its own domain', () => {
    expect(isSharedHost('rippling.com', 'Rippling')).toBe(false);
    expect(isSharedHost('google.com', 'Google')).toBe(false);
    expect(isSharedHost('rippling.com', 'Ramp')).toBe(true);
  });
});

describe('employerDomain', () => {
  it('reads the host of a website', () => {
    expect(employerDomain('https://www.herondata.io')).toBe('herondata.io');
  });

  it('gives nothing for a careers link on a board', () => {
    expect(employerDomain('https://jobs.ashbyhq.com/herondata/bd22b726')).toBeNull();
  });

  it('gives nothing for something that is not a host', () => {
    expect(employerDomain('N/A')).toBeNull();
    expect(employerDomain(null)).toBeNull();
  });
});

describe('companyNameKey', () => {
  it('takes filler words off the end', () => {
    expect(companyNameKey('Heron Data')).toBe('heron');
    expect(companyNameKey('Heron')).toBe('heron');
    expect(companyNameKey('Scale AI')).toBe('scale');
    expect(companyNameKey('Acme, Inc.')).toBe('acme');
  });

  it('joins initials and drops punctuation', () => {
    expect(companyNameKey('D. E. Shaw & Co.')).toBe(companyNameKey('D. E. Shaw'));
    expect(companyNameKey('Das GreenHaus')).toBe(companyNameKey('Dasgreenhaus'));
  });

  it('never strips a name to nothing', () => {
    expect(companyNameKey('Data')).toBe('data');
    expect(companyNameKey('The Labs')).toBe('labs');
  });
});

const heronData = {
  id: 'heron-data',
  name: 'Heron Data',
  domains: ['jobs.ashbyhq.com'],
  website: 'https://www.herondata.io',
  ats_type: 'ashby',
  ats_board_token: 'herondata',
};
const heron = {
  id: 'heron',
  name: 'Heron',
  domains: ['herondata.io'],
  website: 'https://www.herondata.io',
  ats_type: 'ashby',
  ats_board_token: 'herondata',
};

describe('sameCompany', () => {
  it('matches Heron and Heron Data on their board', () => {
    expect(sameCompany(heron, heronData)).toBe('board');
  });

  it('matches on an employer domain, including the website', () => {
    expect(sameCompany({ name: 'Heron' , domains: ['herondata.io'] }, { name: 'Heron Data', website: 'herondata.io' })).toBe('domain');
    expect(sameCompany({ name: 'Finance Associate', domains: ['jobs.bendingspoons.com'] }, { name: 'Bending Spoons', domains: ['bendingspoons.com'] })).toBe('domain');
  });

  it('never matches two companies on the board host they share', () => {
    expect(sameCompany({ name: 'Ramp', domains: ['jobs.ashbyhq.com'] }, { name: 'Clay', domains: ['jobs.ashbyhq.com'] })).toBeNull();
  });

  it('does not match one board token under two vendors', () => {
    expect(
      sameCompany(
        { name: 'Acme', ats_type: 'greenhouse', ats_board_token: 'acme' },
        { name: 'Zeta', ats_type: 'lever', ats_board_token: 'acme' },
      ),
    ).toBeNull();
  });

  it('matches on the name key', () => {
    expect(sameCompany({ name: 'Scale' }, { name: 'Scale AI' })).toBe('name');
    expect(sameCompany({ name: 'Ramp' }, { name: 'Clay' })).toBeNull();
  });
});

describe('findSameCompany', () => {
  it('prefers the strongest reason', () => {
    const byName = { id: 'a', name: 'Heron Labs' };
    expect(findSameCompany(heron, [byName, heronData])?.company.id).toBe('heron-data');
  });

  it('will not guess between two rows that only share a name', () => {
    expect(findSameCompany({ name: 'Heron' }, [{ id: 'a', name: 'Heron Data' }, { id: 'b', name: 'Heron Labs' }])).toBeNull();
  });

  it('takes a lone name match', () => {
    expect(findSameCompany({ name: 'Heron' }, [{ id: 'a', name: 'Heron Data' }, { id: 'b', name: 'Ramp' }])?.company.id).toBe('a');
  });
});

describe('duplicatePairs', () => {
  it('lists each pair once, strongest first', () => {
    const pairs = duplicatePairs([{ id: 's', name: 'Scale' }, heron, { id: 'sa', name: 'Scale AI' }, heronData]);
    expect(pairs.map((pair) => pair.reason)).toEqual(['board', 'name']);
  });
});
