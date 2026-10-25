import { describe, expect, it } from 'vitest';
import {
  considerPostings,
  considerSession,
  getroDone,
  getroPostings,
  possessive,
  postedSince,
  readSince,
} from './portfolio-parse';

// Trimmed from jobs.rre.com's Getro search, 25 Oct 2026.
const getroPage = {
  results: {
    count: 2038,
    jobs: [
      {
        id: 98024728,
        title: 'Senior Product Manager, Payments',
        url: 'https://boards.greenhouse.io/ripple/jobs/8180206',
        slug: '98024728-senior-product-manager-payments',
        created_at: 1792860516,
        locations: ['New York, NY, USA', 'Remote'],
        organization: { name: 'Ripple', slug: 'ripple', id: 1 },
      },
      {
        id: 98024727,
        title: 'Care Coordinator',
        url: null,
        slug: '98024727-care-coordinator',
        created_at: 1792600000,
        locations: [],
        organization: { name: 'Collective Health', slug: 'collective-health', id: 899 },
      },
      { id: 3, title: '', url: 'https://x.test', organization: { name: 'Nameless' } },
    ],
  },
};

// Trimmed from jobs.anthemis.com's Consider search, 25 Oct 2026.
const considerPage = {
  jobs: [
    {
      title: 'Senior People Partner',
      companyName: 'Hometree',
      url: 'https://hometree-1690194722.teamtailor.com/jobs/8611081-senior-people-partner',
      applyUrl: 'https://hometree-1690194722.teamtailor.com/jobs/8611081-senior-people-partner',
      locations: ['United Kingdom, GB'],
      timeStamp: '2026-10-23T18:54:43Z',
    },
    { title: 'Analyst', companyName: 'Felix', applyUrl: 'https://jobs.gem.com/felix/abc', locations: [], timeStamp: 'not a date' },
    { title: 'No company', url: 'https://x.test/1' },
  ],
  meta: { size: 3, sequence: 'eyJfaWQiOiAiZTBm' },
  total: 634,
};

describe('getroPostings', () => {
  it('reads each posting with its own company, the source link and when it went up', () => {
    const { postings, total } = getroPostings(getroPage, 'https://jobs.rre.com');
    expect(total).toBe(2038);
    expect(postings).toEqual([
      {
        title: 'Senior Product Manager, Payments',
        url: 'https://boards.greenhouse.io/ripple/jobs/8180206',
        company: 'Ripple',
        location: 'New York, NY, USA; Remote',
        postedAt: new Date(1792860516 * 1000).toISOString(),
      },
      {
        title: 'Care Coordinator',
        url: 'https://jobs.rre.com/companies/collective-health/jobs/98024727-care-coordinator',
        company: 'Collective Health',
        location: null,
        postedAt: new Date(1792600000 * 1000).toISOString(),
      },
    ]);
  });

  it('drops a posting with no link when the board is not known', () => {
    expect(getroPostings(getroPage, null).postings.map((p) => p.company)).toEqual(['Ripple']);
  });

  it('reads an answer with no jobs as empty', () => {
    expect(getroPostings({}, null)).toEqual({ postings: [], total: null });
  });
});

describe('getroDone', () => {
  const { postings } = getroPostings(getroPage, 'https://jobs.rre.com');
  it('stops on an empty page or once the oldest posting is before since', () => {
    expect(getroDone([], new Date(0))).toBe(true);
    expect(getroDone(postings, new Date(1792700000 * 1000))).toBe(true);
    expect(getroDone(postings, new Date(1792500000 * 1000))).toBe(false);
  });
});

describe('considerSession', () => {
  it('finds the CSRF token and the board in the page', () => {
    const html =
      '<script>window.serverInitialData = {"fixedBoard":"anthemis-group","csrfToken":"HNXe3zWN-Z7C","board":{"id":"anthemis-group","isParent":true},"clientConfig":{}}</script>';
    expect(considerSession(html)).toEqual({ csrf: 'HNXe3zWN-Z7C', board: { id: 'anthemis-group', isParent: true } });
  });

  it('is null for a page that is not a Consider board', () => {
    expect(considerSession('<html>Not found</html>')).toBeNull();
  });
});

describe('considerPostings', () => {
  it('reads each posting and the sequence for the next page', () => {
    const { postings, sequence } = considerPostings(considerPage);
    expect(sequence).toBe('eyJfaWQiOiAiZTBm');
    expect(postings).toEqual([
      {
        title: 'Senior People Partner',
        company: 'Hometree',
        url: 'https://hometree-1690194722.teamtailor.com/jobs/8611081-senior-people-partner',
        location: 'United Kingdom, GB',
        postedAt: '2026-10-23T18:54:43.000Z',
      },
      { title: 'Analyst', company: 'Felix', url: 'https://jobs.gem.com/felix/abc', location: null, postedAt: null },
    ]);
  });

  it('has no sequence on the last page', () => {
    expect(considerPostings({ jobs: [], meta: {} }).sequence).toBeNull();
  });
});

describe('postedSince', () => {
  it('keeps what went up at or after the date, and what gives no date', () => {
    const { postings } = considerPostings(considerPage);
    expect(postedSince(postings, new Date('2026-10-24T00:00:00Z')).map((p) => p.company)).toEqual(['Felix']);
    expect(postedSince(postings, new Date('2026-10-23T00:00:00Z'))).toHaveLength(2);
  });
});

describe('readSince', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  it('looks back a week on the first read', () => {
    expect(readSince(null, now).toISOString()).toBe('2026-10-18T12:00:00.000Z');
  });
  it('looks back a day before the last read', () => {
    expect(readSince('2026-10-24T12:00:00Z', now).toISOString()).toBe('2026-10-23T12:00:00.000Z');
  });
  it('never looks back more than a week', () => {
    expect(readSince('2026-09-01T00:00:00Z', now).toISOString()).toBe('2026-10-18T12:00:00.000Z');
  });
});

describe('possessive', () => {
  it('writes a name ending in s with the apostrophe alone', () => {
    expect(possessive('RRE Ventures')).toBe("RRE Ventures'");
    expect(possessive('Antler')).toBe("Antler's");
  });
});
