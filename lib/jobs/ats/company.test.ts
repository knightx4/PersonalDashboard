import { describe, expect, it, vi } from 'vitest';

import { cleanCompanyName, companyFromBoardToken, companyFromHost, companyFromPage, companyFromTitle, stripCompanyFromTitle } from './company';

const page = (head: string) => `<html><head>${head}</head><body></body></html>`;

describe('cleanCompanyName', () => {
  it('drops a trailing Careers and refuses a name that is only a site label', () => {
    expect(cleanCompanyName('UBS Careers')).toBe('UBS');
    expect(cleanCompanyName('Acme &amp; Sons - Jobs')).toBe('Acme & Sons');
    expect(cleanCompanyName('Careers')).toBeNull();
    expect(cleanCompanyName('Job Search')).toBeNull();
    expect(cleanCompanyName('')).toBeNull();
  });
});

describe('companyFromHost', () => {
  it('names the brand behind the careers subdomain', () => {
    expect(companyFromHost('https://jobs.ubs.com/job/123')).toBe('UBS');
    expect(companyFromHost('https://careers.bbc.co.uk/x')).toBe('BBC');
    expect(companyFromHost('https://join.monzo.com/x')).toBe('Monzo');
    expect(companyFromHost('https://careers.deutsche-bank.com/x')).toBe('Deutsche Bank');
  });
  it('gives nothing for a bare host with no brand', () => {
    expect(companyFromHost('https://careers.com/x')).toBeNull();
    expect(companyFromHost('not a url')).toBeNull();
  });
});

describe('companyFromTitle', () => {
  it('reads the brand from either side of the separator when the role is known', () => {
    expect(companyFromTitle('Data Analyst | UBS', 'Data Analyst')).toBe('UBS');
    expect(companyFromTitle('UBS - Data Analyst', 'Data Analyst')).toBe('UBS');
  });
  it('takes the last segment without the role, skipping a Careers segment', () => {
    expect(companyFromTitle('Data Analyst - London | UBS')).toBe('UBS');
    expect(companyFromTitle('Data Analyst | UBS | Careers')).toBe('UBS');
  });
  it('reads "Role at Company"', () => {
    expect(companyFromTitle('Data Analyst at Acme')).toBe('Acme');
  });
  it('gives nothing for a title that is only a role', () => {
    expect(companyFromTitle('Data Analyst')).toBeNull();
  });
});

describe('stripCompanyFromTitle', () => {
  it('leaves the role without the company or the Careers label', () => {
    expect(stripCompanyFromTitle('Data Analyst | UBS | Careers', 'UBS')).toBe('Data Analyst');
    expect(stripCompanyFromTitle('Data Analyst', 'UBS')).toBe('Data Analyst');
  });
});

describe('companyFromPage', () => {
  const url = 'https://jobs.ubs.com/job/351766';

  it('prefers the JobPosting hiringOrganization, as a name or an Organization', () => {
    const html = page('<meta property="og:site_name" content="Other">');
    expect(companyFromPage({ html, url, posting: { hiringOrganization: { '@type': 'Organization', name: 'UBS AG' } }, ownHost: true })).toEqual({
      name: 'UBS AG',
      source: 'jobposting',
    });
    expect(companyFromPage({ html, url, posting: { hiringOrganization: 'UBS' }, ownHost: true })?.name).toBe('UBS');
  });

  it('falls back to og:site_name whichever order the attributes come in', () => {
    expect(companyFromPage({ html: page('<meta content="UBS Careers" property="og:site_name">'), url, ownHost: false })).toEqual({
      name: 'UBS',
      source: 'site_name',
    });
  });

  it('then the title, then the domain only for the employer’s own host', () => {
    expect(companyFromPage({ html: page('<title>Data Analyst | UBS</title>'), url, role: 'Data Analyst', ownHost: false })).toEqual({
      name: 'UBS',
      source: 'title',
    });
    expect(companyFromPage({ html: page('<title>Data Analyst</title>'), url, ownHost: true })).toEqual({ name: 'UBS', source: 'domain' });
  });

  it('names nothing when the page and host give no employer', () => {
    expect(companyFromPage({ html: page('<title>Data Analyst</title>'), url, ownHost: false })).toBeNull();
    expect(companyFromPage({ html: page('<title>Job Search</title>'), url: 'https://careers.com/1', ownHost: true })).toBeNull();
  });
});

describe('generic.fetchPosting company', () => {
  const body = (head: string) =>
    `<html><head>${head}</head><body>${'<p>Responsibilities include analysing data across the business and reporting.</p>'.repeat(12)}</body></html>`;

  async function readWith(html: string, url = 'https://jobs.ubs.com/job/351766') {
    vi.resetModules();
    vi.doMock('./ssrf', () => ({ safeFetch: async () => ({ status: 200, body: html, url }) }));
    const { fetchPosting } = await import('./generic');
    return fetchPosting(url);
  }

  it('reads the employer from JobPosting data', async () => {
    const ld = JSON.stringify({ '@type': 'JobPosting', title: 'Data Analyst', description: '<p>Do things</p>', hiringOrganization: { name: 'UBS' } });
    const posting = await readWith(body(`<script type="application/ld+json">${ld}</script>`));
    expect(posting).toMatchObject({ title: 'Data Analyst', company: 'UBS' });
  });

  it('reads the employer from the title and leaves the role clean', async () => {
    const posting = await readWith(body('<title>Data Analyst | UBS Careers</title>'), 'https://example.org/jobs/1');
    expect(posting).toMatchObject({ title: 'Data Analyst', company: 'UBS' });
  });

  it('falls back to the domain of the employer’s own site', async () => {
    const posting = await readWith(body('<title>Data Analyst</title>'));
    expect(posting).toMatchObject({ title: 'Data Analyst', company: 'UBS' });
  });
});

describe('companyFromBoardToken', () => {
  it('names the employer from a board slug, keeping one already cased', () => {
    expect(companyFromBoardToken('sent')).toBe('Sent');
    expect(companyFromBoardToken('the-browser-company')).toBe('The Browser Company');
    expect(companyFromBoardToken('OpenAI')).toBe('OpenAI');
    expect(companyFromBoardToken('Acme%20Labs')).toBe('Acme Labs');
  });

  it('gives nothing for no slug or one that is only a site label', () => {
    expect(companyFromBoardToken(null)).toBeNull();
    expect(companyFromBoardToken('careers')).toBeNull();
    expect(companyFromBoardToken('a/b')).toBeNull();
  });
});
