import { describe, expect, it } from 'vitest';
import type { Candidate } from './candidates';
import { cleanText, parseOpeningsPayload, parseOutreachPayload, roleKey, splitSubject } from './payload';

const candidate = (ref: string): Candidate => ({
  ref,
  contactId: `id-${ref}`,
  companyId: 'acme',
  companyName: 'Acme',
  name: 'Priya',
  score: 3,
  facts: [],
});

describe('parseOutreachPayload', () => {
  const entry = (ref: string) => ({
    ref,
    headline: 'Ask Priya for a referral',
    why: 'She replied last month.',
    move: '1. Send the note.',
    channel: 'email',
    message: 'Subject: Data Analyst role\n\nHi Priya — quick question.',
  });

  it('keeps suggestions for known candidates once each, and takes out em dashes', () => {
    const out = parseOutreachPayload(
      { suggestions: [entry('c1'), entry('c1'), entry('c9'), entry('c2')] },
      [candidate('c1'), candidate('c2')],
    );
    expect(out.map((s) => s.candidate.ref)).toEqual(['c1', 'c2']);
    expect(out[0].message).toContain('Hi Priya, quick question.');
  });

  it('drops an entry with no message and reads an unknown channel as other', () => {
    const out = parseOutreachPayload(
      { suggestions: [{ ...entry('c1'), message: '  ' }, { ...entry('c2'), channel: 'fax' }] },
      [candidate('c1'), candidate('c2')],
    );
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe('other');
  });
});

describe('parseOpeningsPayload', () => {
  const opening = (over: Record<string, unknown> = {}) => ({
    company: 'Globex',
    title: 'Senior Data Analyst',
    url: 'https://boards.greenhouse.io/globex/jobs/1#apply',
    location: 'Remote',
    why: 'Matches the analytics work you want.',
    move: '1. Apply.',
    ...over,
  });

  it('refuses a link that is not a web address, one already suggested, and a role already applied for', () => {
    const out = parseOpeningsPayload(
      {
        openings: [
          opening({ url: 'not a url' }),
          opening({ url: 'https://seen.example/1' }),
          opening({ company: 'Acme Inc.', title: 'Data Analyst', url: 'https://acme.example/2' }),
          opening(),
          opening({ url: 'https://boards.greenhouse.io/globex/jobs/1' }),
        ],
      },
      { urls: new Set(['https://seen.example/1']), roles: new Set([roleKey('Acme', 'Data analyst')]) },
    );
    expect(out.map((o) => o.url)).toEqual(['https://boards.greenhouse.io/globex/jobs/1']);
  });
});

describe('text helpers', () => {
  it('turns an em dash into a comma, or a hyphen between numbers', () => {
    expect(cleanText('Two — three')).toBe('Two, three');
    expect(cleanText('2024—2026')).toBe('2024-2026');
  });

  it('splits an email into subject and body', () => {
    expect(splitSubject('Subject: Hello\n\nBody here')).toEqual({ subject: 'Hello', body: 'Body here' });
    expect(splitSubject('No subject')).toEqual({ subject: null, body: 'No subject' });
  });
});
