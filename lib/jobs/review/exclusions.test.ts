import { describe, expect, it } from 'vitest';
import { excludableDomains } from '@/lib/jobs/review/exclusions';

describe('excludableDomains', () => {
  it('keeps the employer’s own domains', () => {
    expect(excludableDomains(['Ramp.com', 'ramp.dev'])).toEqual(['ramp.com', 'ramp.dev']);
  });

  it('never offers an ATS domain', () => {
    // greenhouse.io is on the record of every Greenhouse customer. Excluding
    // it to be rid of one employer would silence all of them.
    expect(excludableDomains(['us.greenhouse-mail.io', 'ramp.com'])).toEqual(['ramp.com']);
    expect(excludableDomains(['greenhouse.io', 'lever.co', 'ashbyhq.com'])).toEqual([]);
  });

  it('never offers a scheduling tool', () => {
    expect(excludableDomains(['calendly.com'])).toEqual([]);
  });

  it('is empty rather than noisy for a company with nothing usable on file', () => {
    expect(excludableDomains(null)).toEqual([]);
    expect(excludableDomains([])).toEqual([]);
    expect(excludableDomains(['', '   ', null])).toEqual([]);
  });

  it('does not repeat a domain that differs only in case', () => {
    expect(excludableDomains(['ramp.com', 'RAMP.com'])).toEqual(['ramp.com']);
  });
});
