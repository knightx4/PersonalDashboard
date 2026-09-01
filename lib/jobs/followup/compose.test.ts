import { describe, expect, it } from 'vitest';
import {
  addressOnly,
  composeFollowUp,
  displayName,
  firstName,
  gmailComposeUrl,
  humanGap,
} from '@/lib/jobs/followup/compose';

const NOW = new Date('2026-09-01T10:00:00Z');

describe('the follow-up itself', () => {
  it('names the role and how long it has been', () => {
    const draft = composeFollowUp({
      companyName: 'Ramp',
      roleTitle: 'Strategic Finance Analyst',
      appliedAt: '2026-08-01T10:00:00Z',
      now: NOW,
    });
    expect(draft.subject).toBe('Following up — Strategic Finance Analyst at Ramp');
    expect(draft.body).toContain('Strategic Finance Analyst role at Ramp');
    expect(draft.body).toContain('a few weeks ago');
  });

  it('still writes a sensible note when the role is unknown', () => {
    const draft = composeFollowUp({ companyName: 'Ramp', roleTitle: null, appliedAt: null, now: NOW });
    expect(draft.subject).toBe('Following up on my application to Ramp');
    expect(draft.body).toContain('I applied at Ramp and wanted to check in.');
    // No date on file must not become "about null ago".
    expect(draft.body).not.toMatch(/about\s+(null|undefined|NaN)/);
  });

  it('greets a recruiter by first name when the mail gave one', () => {
    const draft = composeFollowUp({
      companyName: 'Ramp',
      roleTitle: 'Analyst',
      appliedAt: null,
      recipientName: 'Dana Whitfield',
      now: NOW,
    });
    expect(draft.body.startsWith('Hi Dana,')).toBe(true);
  });

  it('falls back to a plain greeting rather than guessing at a no-reply address', () => {
    const draft = composeFollowUp({
      companyName: 'Ramp',
      roleTitle: null,
      appliedAt: null,
      recipientName: 'no-reply@ashbyhq.com',
      now: NOW,
    });
    expect(draft.body.startsWith('Hello,')).toBe(true);
  });

  it('asks one question that can be answered in a line', () => {
    const draft = composeFollowUp({ companyName: 'Ramp', roleTitle: null, appliedAt: null, now: NOW });
    expect(draft.body).toContain('where the search stands');
    expect((draft.body.match(/\?/g) ?? []).length).toBe(1);
  });

  it('ignores a date it cannot read instead of writing nonsense', () => {
    const draft = composeFollowUp({
      companyName: 'Ramp',
      roleTitle: null,
      appliedAt: 'not a date',
      now: NOW,
    });
    expect(draft.body).not.toContain('Invalid');
    expect(draft.body).toContain('I applied at Ramp and wanted to check in.');
  });
});

describe('how long it has been, in words', () => {
  it('counts days while days still mean something', () => {
    expect(humanGap(new Date('2026-08-27T10:00:00Z'), NOW)).toBe('5 days');
  });

  it('rounds off once it does not', () => {
    expect(humanGap(new Date('2026-08-18T10:00:00Z'), NOW)).toBe('a couple of weeks');
    expect(humanGap(new Date('2026-08-01T10:00:00Z'), NOW)).toBe('a few weeks');
    expect(humanGap(new Date('2026-07-01T10:00:00Z'), NOW)).toBe('a month or so');
    expect(humanGap(new Date('2026-01-01T10:00:00Z'), NOW)).toBe('a while');
  });

  it('never goes negative on a date in the future', () => {
    expect(humanGap(new Date('2026-12-01T10:00:00Z'), NOW)).toBe('0 days');
  });
});

describe('reading a From header', () => {
  it('takes the address out of a full header', () => {
    expect(addressOnly('Kalshi Hiring Team <no-reply@ashbyhq.com>')).toBe('no-reply@ashbyhq.com');
    expect(addressOnly('dana@ramp.com')).toBe('dana@ramp.com');
  });

  it('returns nothing rather than a broken address', () => {
    expect(addressOnly('Kalshi Hiring Team')).toBeNull();
    expect(addressOnly(null)).toBeNull();
  });

  it('takes the display name, quoted or not', () => {
    expect(displayName('Dana Whitfield <dana@ramp.com>')).toBe('Dana Whitfield');
    expect(displayName('"Whitfield, Dana" <dana@ramp.com>')).toBe('Whitfield, Dana');
    expect(displayName('dana@ramp.com')).toBeNull();
  });

  it('finds the first name in either ordering', () => {
    expect(firstName('Dana Whitfield')).toBe('Dana');
    expect(firstName('Whitfield, Dana')).toBe('Dana');
    expect(firstName('no-reply@ashbyhq.com')).toBeNull();
    expect(firstName('X')).toBeNull();
  });
});

describe('the compose link', () => {
  it('opens the connected account with everything filled in', () => {
    const url = new URL(
      gmailComposeUrl({
        emailAddress: 'me@example.com',
        to: 'dana@ramp.com',
        subject: 'Following up — Analyst at Ramp',
        body: 'Hi Dana,\n\nchecking in.',
      }),
    );
    expect(url.searchParams.get('authuser')).toBe('me@example.com');
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('to')).toBe('dana@ramp.com');
    expect(url.searchParams.get('su')).toBe('Following up — Analyst at Ramp');
    expect(url.searchParams.get('body')).toContain('Hi Dana,');
  });

  it('still composes when there is nobody to address it to', () => {
    const url = new URL(
      gmailComposeUrl({ emailAddress: null, to: null, subject: 'x', body: 'y' }),
    );
    expect(url.searchParams.has('to')).toBe(false);
    expect(url.searchParams.has('authuser')).toBe(false);
  });
});
