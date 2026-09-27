import { describe, expect, it } from 'vitest';
import { firstLink, linkBareDomains } from './result-links';

describe('linkBareDomains', () => {
  it('turns a bare domain and its path into a link, leaving the full stop outside', () => {
    expect(linkBareDomains('Sign up at transalt.org/volunteer.')).toBe(
      'Sign up at [transalt.org/volunteer](https://transalt.org/volunteer).',
    );
  });

  it('links each domain in a list of sources', () => {
    expect(linkBareDomains('Sources: openplans.org/get-involved, opennewyork.org')).toBe(
      'Sources: [openplans.org/get-involved](https://openplans.org/get-involved), [opennewyork.org](https://opennewyork.org)',
    );
  });

  it('links a domain in brackets', () => {
    expect(linkBareDomains('The Get Involved page (openplans.org/get-involved) points')).toBe(
      'The Get Involved page ([openplans.org/get-involved](https://openplans.org/get-involved)) points',
    );
  });

  it('leaves email addresses, written links, full addresses and code alone', () => {
    const text = [
      'Email hello@openplans.org or shawn.garcia@transalt.org.',
      'See [the page](https://transalt.org/volunteer) and https://opennewyork.org/events.',
      'Run `npm.org` and read [transalt.org](https://transalt.org).',
    ].join('\n');
    expect(linkBareDomains(text)).toBe(text);
  });

  it('leaves words with dots that are not sites', () => {
    const text = 'e.g. the notes.md file, Node.js and $118,000.50';
    expect(linkBareDomains(text)).toBe(text);
  });
});

describe('firstLink', () => {
  it('takes the first bare domain', () => {
    expect(
      firstLink('Email hello@openplans.org. Sign up at transalt.org/volunteer. Or opennewyork.org.'),
    ).toBe('https://transalt.org/volunteer');
  });

  it('takes a written link or a full address', () => {
    expect(firstLink('Read [the guide](https://example.org/guide) first.')).toBe(
      'https://example.org/guide',
    );
    expect(firstLink('Read https://example.org/guide.')).toBe('https://example.org/guide');
  });

  it('is null when the result names no place', () => {
    expect(firstLink('Call them on Monday; email hello@openplans.org.')).toBeNull();
  });
});
