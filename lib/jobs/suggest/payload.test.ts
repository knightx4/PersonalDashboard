import { describe, expect, it } from 'vitest';
import {
  cleanText,
  linkedinSearchUrl,
  parseOpeningsPayload,
  parsePeoplePayload,
  personKey,
  roleKey,
  splitSubject,
} from './payload';

describe('parsePeoplePayload', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    person_name: 'Dana Wu',
    person_title: 'Director of Strategic Finance',
    company: 'Ramp',
    source_url: 'https://ramp.com/team#dana',
    search_query: 'Dana Wu Ramp',
    headline: 'Ask Dana Wu about strategic finance at Ramp',
    why: 'She moved from FP&A into strategic finance, the step you want.',
    move: '1. Send the note.',
    channel: 'linkedin_connect',
    message: 'Hi Dana — I read your post on planning cycles.',
    ...over,
  });

  it('keeps a new person once, drops someone already known, and takes out em dashes', () => {
    const out = parsePeoplePayload(
      { suggestions: [entry(), entry({ person_name: 'dana  wu' }), entry({ person_name: 'Sam Old' }), entry({ person_name: 'Lee Park' })] },
      { people: new Set([personKey('Sam Old')]) },
    );
    expect(out.map((s) => s.personName)).toEqual(['Dana Wu', 'Lee Park']);
    expect(out[0]).toMatchObject({ sourceUrl: 'https://ramp.com/team', searchQuery: 'Dana Wu Ramp', channel: 'linkedin_connect' });
    expect(out[0].message).toBe('Hi Dana, I read your post on planning cycles.');
  });

  it('keeps an event with no person, and drops an entry with no message', () => {
    const out = parsePeoplePayload(
      {
        suggestions: [
          entry({ person_name: null, person_title: null, channel: 'event', headline: 'Go to the FP&A meetup' }),
          entry({ person_name: 'Lee Park', message: ' ' }),
        ],
      },
      { people: new Set() },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ personName: null, channel: 'event' });
  });

  it('keeps at most three and reads an unknown channel as other', () => {
    const out = parsePeoplePayload(
      { suggestions: ['A B', 'C D', 'E F', 'G H'].map((name) => entry({ person_name: name, channel: 'fax' })) },
      { people: new Set() },
    );
    expect(out).toHaveLength(3);
    expect(out[0].channel).toBe('other');
  });

  it('builds the LinkedIn people search', () => {
    expect(linkedinSearchUrl('FP&A Ramp')).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=FP%26A%20Ramp',
    );
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
