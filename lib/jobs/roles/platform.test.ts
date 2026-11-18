import { describe, expect, it } from 'vitest';
import { isPostingPlatform, platformFromLink, shownPlatform } from './platform';

describe('posting platform', () => {
  it('reads the platform from a posting link', () => {
    expect(platformFromLink('https://jobs.ashbyhq.com/acme/1234')).toBe('ashby');
    expect(platformFromLink('https://boards.greenhouse.io/acme/jobs/555')).toBe('greenhouse');
    expect(platformFromLink('https://acme.com/careers/analyst')).toBeNull();
    expect(platformFromLink(null)).toBeNull();
    expect(platformFromLink('not a link')).toBeNull();
  });

  it('shows what was typed over what the link says, and says which', () => {
    expect(shownPlatform('in_house', 'https://jobs.ashbyhq.com/acme/1')).toEqual({ label: "In-house (the company's own site)", fromLink: false });
    expect(shownPlatform(null, 'https://jobs.ashbyhq.com/acme/1')).toEqual({ label: 'Ashby', fromLink: true });
    expect(shownPlatform(null, null)).toBeNull();
  });

  it('knows the values the database takes', () => {
    expect(isPostingPlatform('workday')).toBe(true);
    expect(isPostingPlatform('unknown')).toBe(false);
  });
});
