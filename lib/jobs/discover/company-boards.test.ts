import { describe, expect, it } from 'vitest';

import type { BoardIo } from './boards';
import {
  domainNamesCompany,
  findCompanyBoards,
  isSkippedCompany,
  registrableDomain,
  websiteFromDomains,
  websiteFromWikidata,
} from './company-boards';
import type { WikidataCompany } from '@/lib/jobs/enrich/wikidata';

function web(pages: Record<string, string>, boards: string[] = []) {
  const fetched: string[] = [];
  const io: BoardIo = {
    fetchPage: async (url) => {
      fetched.push(url);
      const key = url.replace(/\/$/, '');
      if (!(key in pages)) return { url, status: 404, body: 'Not found' };
      return { url, status: 200, body: pages[key] };
    },
    readBoard: async (vendor, token) => {
      if (!boards.includes(`${vendor}:${token}`)) throw new Error('404');
      return [];
    },
  };
  return { io, fetched };
}

function wiki(label: string, websiteUrl: string | null): WikidataCompany {
  return {
    wikidataId: `Q${label.length}`,
    label,
    description: null,
    websiteDomain: websiteUrl ? new URL(websiteUrl).hostname.replace(/^www\./, '') : null,
    websiteUrl,
    industry: null,
    headquarters: null,
    employees: null,
    employeesAsOf: null,
    foundedYear: null,
    isPublicCompany: false,
    logoUrl: null,
    linkedinUrl: null,
  };
}

describe('isSkippedCompany', () => {
  it('leaves out recruiting agencies by industry or name, and stealth rows', () => {
    expect(isSkippedCompany({ name: 'Acme', industry: 'Staffing and Recruiting' })).toBe(true);
    for (const name of ['Arrow Search Partners', 'Cobalt Recruitment', 'Mission Staffing', 'Lime Talent', 'Advice Personnel', 'Blueprint Recruiting LLC', 'Stealth Startup', 'stealth']) {
      expect(isSkippedCompany({ name, industry: null })).toBe(true);
    }
  });

  it('keeps employers whose names only look close', () => {
    for (const name of ['Lam Research', 'Centerview Partners', 'Boston Consulting Group', 'Stealthy Labs', 'Bridgewater Associates']) {
      expect(isSkippedCompany({ name, industry: null })).toBe(false);
    }
  });
});

describe('websites from the row', () => {
  it('takes the registrable domain', () => {
    expect(registrableDomain('mail.apply.careers.hsbc.com')).toBe('hsbc.com');
    expect(registrableDomain('jobs.acme.co.uk')).toBe('acme.co.uk');
  });

  it("takes a domain only when it names the company, not a vendor's mail host", () => {
    expect(domainNamesCompany('ridewithvia.com', 'Via')).toBe(true);
    expect(domainNamesCompany('zenity.comeet-notifications.com', 'Zenity')).toBe(false);
    expect(domainNamesCompany('deshaw.com', 'D. E. Shaw & Co.')).toBe(true);
    expect(domainNamesCompany('bcg.com', 'Boston Consulting Group')).toBe(true);
    expect(websiteFromDomains('HSBC', ['mail.apply.careers.hsbc.com'])).toBe('https://hsbc.com');
    expect(websiteFromDomains('Shield Technology Partners', ['pinpoint.email'])).toBeNull();
    expect(websiteFromDomains('Acme', ['greenhouse.io', 'acme.dev'])).toBe('https://acme.dev');
    expect(websiteFromDomains('Acme', null)).toBeNull();
  });
});

describe('websiteFromWikidata', () => {
  it('takes a website that matches a domain on the row', () => {
    expect(websiteFromWikidata({ name: 'Ramp', domains: ['ramp.com'] }, [wiki('Ramp', 'https://ramp.com'), wiki('Ramp', 'https://ramps.example')])).toBe('https://ramp.com');
  });

  it('takes a lone exact name, and nothing when two share it', () => {
    expect(websiteFromWikidata({ name: 'Lumen', domains: [] }, [wiki('Lumen Field', 'https://lumenfield.com'), wiki('Lumen', 'https://lumen.example')])).toBe('https://lumen.example');
    expect(websiteFromWikidata({ name: 'Ramp', domains: [] }, [wiki('Ramp', 'https://ramp.com'), wiki('Ramp', 'https://ramps.example')])).toBeNull();
    expect(websiteFromWikidata({ name: 'Ramp', domains: [] }, [wiki('Ramp Industries Ltd', 'https://other.example')])).toBeNull();
  });
});

describe('findCompanyBoards', () => {
  type Row = Record<string, unknown>;
  function fakeSupabase(rows: Row[]) {
    const filters: string[] = [];
    return {
      filters,
      client: {
        from() {
          let patch: Row | null = null;
          const where: Record<string, unknown> = {};
          const chain = {
            select: () => chain,
            eq: (column: string, value: unknown) => {
              where[column] = value;
              if (patch && 'id' in where && 'user_id' in where) {
                const row = rows.find((r) => r.id === where.id && r.user_id === where.user_id);
                if (row) Object.assign(row, patch);
                return Promise.resolve({ error: null });
              }
              return chain;
            },
            or: (filter: string) => {
              filters.push(filter);
              return chain;
            },
            order: () => chain,
            limit: () =>
              Promise.resolve({ data: rows.filter((r) => r.user_id === where.user_id).map((r) => ({ ...r })), error: null }),
            update: (value: Row) => {
              patch = value;
              return chain;
            },
          };
          return chain;
        },
      } as never,
    };
  }

  const base = { user_id: 'u1', industry: null, website: null, careers_url: null, domains: [], ats_type: 'unknown', ats_board_token: null, ats_board_checked_at: null };

  it('finds boards from the row, then Wikidata, skips agencies and boards Dash reads, and stamps every look', async () => {
    const now = new Date('2026-10-25T00:00:00Z');
    const rows: Row[] = [
      { ...base, id: 'a', name: 'Acme', domains: ['acme.dev'] },
      { ...base, id: 'b', name: 'Wiki Co', ats_board_token: 'wikico' },
      { ...base, id: 'c', name: 'Nowhere' },
      { ...base, id: 'd', name: 'Glocap Search' },
      { ...base, id: 'e', name: 'Read Already', ats_type: 'lever', ats_board_token: 'readalready' },
    ];
    const { io, fetched } = web(
      {
        'https://acme.dev': '<a href="https://jobs.ashbyhq.com/acme">Jobs</a>',
        'https://wiki.example': '<a href="https://boards.greenhouse.io/wikico">Careers</a>',
      },
      ['ashby:acme', 'greenhouse:wikico'],
    );
    const looked: string[] = [];
    const lookupSite = async (company: { name: string }) => {
      looked.push(company.name);
      return company.name === 'Wiki Co' ? 'https://wiki.example' : null;
    };
    const fake = fakeSupabase(rows);
    const out = await findCompanyBoards(fake.client, 'u1', { now, io, lookupSite, deadline: Date.now() + 600_000 });

    expect(out).toEqual({ checked: 3, found: 2, noSite: 1, left: 0 });
    expect(rows[0]).toMatchObject({ ats_type: 'ashby', ats_board_token: 'acme', ats_board_checked_at: now.toISOString() });
    expect(rows[1]).toMatchObject({ ats_type: 'greenhouse', ats_board_token: 'wikico' });
    expect(rows[2]).toMatchObject({ ats_board_token: null, ats_board_checked_at: now.toISOString() });
    expect(rows[3].ats_board_checked_at).toBeNull();
    expect(rows[4].ats_board_checked_at).toBeNull();
    expect(looked).toEqual(['Wiki Co', 'Nowhere']);
    expect(fetched.some((url) => url.includes('glocap'))).toBe(false);
    expect(fake.filters[0]).toBe('ats_board_checked_at.is.null,ats_board_checked_at.lt.2026-09-27T00:00:00.000Z');
  });

  it('starts nothing when the time has run out', async () => {
    const rows: Row[] = [{ ...base, id: 'a', name: 'Acme', website: 'https://acme.dev' }];
    const { io, fetched } = web({});
    const out = await findCompanyBoards(fakeSupabase(rows).client, 'u1', { io, lookupSite: async () => null, deadline: Date.now() + 1_000 });
    expect(out).toEqual({ checked: 0, found: 0, noSite: 0, left: 1 });
    expect(fetched).toEqual([]);
    expect(rows[0].ats_board_checked_at).toBeNull();
  });
});
