import { describe, expect, it } from 'vitest';
import { boardCandidates, confirmsBoard, slugCandidates } from './discover';
import type { FetchedPosting } from './types';

/**
 * The search order is the request budget and the false-positive surface at
 * once, so it is tested directly rather than left to emerge from a loop.
 */

function identity(over: Partial<Parameters<typeof boardCandidates>[0]> = {}) {
  return {
    name: 'Acme Corp',
    atsType: null,
    boardToken: null,
    boardHint: null,
    careersUrl: null,
    website: null,
    ...over,
  };
}

function posting(title: string): FetchedPosting {
  return {
    vendor: 'greenhouse',
    title,
    text: '',
    url: null,
    location: null,
    atsJobId: null,
    boardToken: 'acme',
    questions: [],
  };
}

describe('slugCandidates', () => {
  it('drops the legal tail, because board tokens never carry it', () => {
    expect(slugCandidates('Acme Corp, Inc.')).toContain('acme');
  });

  it('offers the first word for a two-word name', () => {
    // "Ramp Financial" is `ramp` on Greenhouse far more often than not.
    expect(slugCandidates('Ramp Financial')).toContain('ramp');
    expect(slugCandidates('Ramp Financial')).toContain('rampfinancial');
  });

  it('does not offer a first word too short to be a board', () => {
    expect(slugCandidates('X Company')).not.toContain('x');
  });

  it('keeps the untrimmed form too, since the tail is sometimes the name', () => {
    expect(slugCandidates('Systems Limited')).toContain('systemslimited');
  });

  it('has nothing to offer for a name with no letters in it', () => {
    expect(slugCandidates('—')).toEqual([]);
  });
});

describe('boardCandidates', () => {
  it('tries a proven token first and, with the vendor known, only that', () => {
    const candidates = boardCandidates(
      identity({ atsType: 'greenhouse', boardToken: 'acme' }),
    );

    expect(candidates[0]).toEqual({ vendor: 'greenhouse', token: 'acme', trust: 'known' });
    // Discovery stops at the first board that answers, so the common case is
    // one call for the whole company. What follows is only reached if the
    // proven token has gone stale, and all of it is on the known vendor.
    expect(candidates.slice(1).every((candidate) => candidate.trust === 'guess')).toBe(true);
    expect(candidates.every((candidate) => candidate.vendor === 'greenhouse')).toBe(true);
  });

  it('trusts a Workday careers URL and never guesses a Workday board', () => {
    const fromLink = boardCandidates(
      identity({ name: 'Citi', careersUrl: 'https://citi.wd5.myworkdayjobs.com/en-US/2' }),
    );
    expect(fromLink[0]).toEqual({ vendor: 'workday', token: 'citi/wd5/2', trust: 'known' });
    expect(fromLink.slice(1).some((candidate) => candidate.vendor === 'workday')).toBe(false);

    const onWorkday = boardCandidates(identity({ name: 'Citi', atsType: 'workday', boardHint: 'citi' }));
    expect(onWorkday.length).toBeGreaterThan(0);
    expect(onWorkday.some((candidate) => candidate.vendor === 'workday')).toBe(false);
  });

  it('tries a stored Workday token only at Workday', () => {
    expect(boardCandidates(identity({ name: 'Citi', atsType: 'workday', boardToken: 'citi/wd5/2' }))[0]).toEqual({
      vendor: 'workday',
      token: 'citi/wd5/2',
      trust: 'known',
    });
    const unrecorded = boardCandidates(identity({ name: 'Citi', boardToken: 'citi/wd5/2' }));
    expect(unrecorded.filter((candidate) => candidate.trust === 'known')).toEqual([
      { vendor: 'workday', token: 'citi/wd5/2', trust: 'known' },
    ]);
  });

  it('reads the board out of a careers URL and trusts it', () => {
    const candidates = boardCandidates(
      identity({ careersUrl: 'https://boards.greenhouse.io/acme' }),
    );

    expect(candidates[0]).toEqual({ vendor: 'greenhouse', token: 'acme', trust: 'known' });
  });

  it('treats a mail subdomain as a guess, not as a proven token', () => {
    const candidates = boardCandidates(
      identity({ atsType: 'greenhouse', boardHint: 'ramp', name: 'Ramp' }),
    );

    expect(candidates[0]).toEqual({ vendor: 'greenhouse', token: 'ramp', trust: 'guess' });
  });

  it('ranks the hint above anything guessed from the company name', () => {
    const candidates = boardCandidates(
      identity({ atsType: 'lever', boardHint: 'acmeinc', name: 'Acme Corp' }),
    );

    expect(candidates[0].token).toBe('acmeinc');
    expect(candidates.slice(1).map((c) => c.token)).toContain('acme');
  });

  it('caps the search, because an unknown vendor is nine doors per slug', () => {
    const candidates = boardCandidates(identity({ name: 'Acme Corporation Holdings' }));

    expect(candidates.length).toBeLessThanOrEqual(12);
    expect(candidates.every((candidate) => candidate.trust === 'guess')).toBe(true);
  });

  it('never repeats a (vendor, token) pair', () => {
    const candidates = boardCandidates(
      identity({ atsType: 'greenhouse', boardToken: 'acme', boardHint: 'acme', name: 'Acme' }),
    );
    const keys = candidates.map((candidate) => `${candidate.vendor}:${candidate.token}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has nothing to try for a company with no name and no tokens', () => {
    expect(boardCandidates(identity({ name: '' }))).toEqual([]);
  });
});

describe('confirmsBoard', () => {
  it('accepts a board carrying a role we already hold there', () => {
    expect(confirmsBoard([posting('Backend Engineer')], ['Backend Engineer'])).toBe(true);
  });

  it('rejects a board that merely returned somebody jobs', () => {
    // The whole reason guessing is allowed: a different Acme's board answers
    // just as successfully as the right one.
    expect(confirmsBoard([posting('Dental Hygienist')], ['Backend Engineer'])).toBe(false);
  });

  it('cannot be confirmed by a role with no title', () => {
    expect(confirmsBoard([posting('Backend Engineer')], [''])).toBe(false);
  });
});
