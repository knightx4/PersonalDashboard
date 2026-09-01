import { describe, expect, it } from 'vitest';
import { matchPosting, normalizeTitle, titleSimilarity, FUZZY_MIN } from './match';
import type { FetchedPosting } from './types';

/**
 * The matcher is where a wrong job description comes from, so these are mostly
 * tests that it declines. A missed match costs one paste; a confident wrong one
 * silently misinforms the requirement map, the seniority guess and every answer
 * written against it.
 */

function posting(title: string, atsJobId: string | null = null): FetchedPosting {
  return {
    vendor: 'greenhouse',
    title,
    text: 'Body.',
    url: null,
    location: null,
    atsJobId,
    boardToken: 'acme',
    questions: [],
  };
}

describe('normalizeTitle', () => {
  it('drops the decoration boards add and the role does not have', () => {
    expect(normalizeTitle('Senior Backend Engineer (Remote) [R12345]')).toBe(
      'senior backend engineer',
    );
  });

  it('drops requisition ids in the shapes boards write them', () => {
    expect(normalizeTitle('Product Manager REQ-4471')).toBe('product manager');
    expect(normalizeTitle('Product Manager #4471')).toBe('product manager');
    expect(normalizeTitle('Product Manager 100294')).toBe('product manager');
  });

  it('keeps the characters that are part of a job title', () => {
    expect(normalizeTitle('C++ Engineer')).toBe('c++ engineer');
    expect(normalizeTitle('Engineer, .NET')).toBe('engineer net');
  });
});

describe('titleSimilarity', () => {
  it('reads a reordered title as the same job', () => {
    expect(titleSimilarity('Senior Backend Engineer', 'Backend Engineer, Senior')).toBe(1);
  });

  it('separates two teams under one discipline', () => {
    // The case that motivates the ambiguity margin: close, and not the same job.
    expect(
      titleSimilarity('Software Engineer, Payments', 'Software Engineer, Payouts'),
    ).toBeLessThan(1);
  });

  it('is zero when nothing is left to compare', () => {
    expect(titleSimilarity('', 'Backend Engineer')).toBe(0);
  });
});

describe('matchPosting', () => {
  it('takes the id when there is one, whatever the titles say', () => {
    const match = matchPosting(
      { title: 'Something Else Entirely', atsJobId: '4471' },
      [posting('Backend Engineer', '4471'), posting('Something Else Entirely', '9999')],
    );

    expect(match.kind).toBe('id');
    expect(match.kind === 'id' && match.posting.atsJobId).toBe('4471');
  });

  it('matches an exact title once the decoration is gone', () => {
    const match = matchPosting({ title: 'Backend Engineer', atsJobId: null }, [
      posting('Backend Engineer (Remote)'),
      posting('Frontend Engineer'),
    ]);

    expect(match.kind).toBe('exact');
  });

  it('refuses two postings with the same title rather than picking one', () => {
    // The same role open in two cities. Nothing here can tell them apart.
    const match = matchPosting({ title: 'Backend Engineer', atsJobId: null }, [
      posting('Backend Engineer (London)'),
      posting('Backend Engineer (New York)'),
    ]);

    expect(match.kind).toBe('ambiguous');
    expect(match.kind === 'ambiguous' && match.candidates).toHaveLength(2);
  });

  it('refuses two postings that are equally close, one of them a level up', () => {
    // The expensive silent error: the seniority guess, the requirement map and
    // every drafted answer would all inherit whichever of these sorted first.
    const match = matchPosting({ title: 'Software Engineer, Payments', atsJobId: null }, [
      posting('Senior Software Engineer, Payments'),
      posting('Software Engineer, Payments Platform'),
    ]);

    expect(match.kind).toBe('ambiguous');
    expect(match.kind === 'ambiguous' && match.candidates).toHaveLength(2);
  });

  it('excludes a sibling team rather than treating it as a rival candidate', () => {
    // "Payouts" is not "Payments"; it must not even reach the ambiguity check.
    const match = matchPosting({ title: 'Software Engineer, Payments', atsJobId: null }, [
      posting('Software Engineer, Payouts'),
      posting('Software Engineer, Payments Platform'),
    ]);

    expect(match.kind).toBe('fuzzy');
    expect(match.kind === 'fuzzy' && match.posting.title).toBe('Software Engineer, Payments Platform');
  });

  it('takes a close title when it is clearly clear of the runner-up', () => {
    const match = matchPosting({ title: 'Senior Backend Engineer', atsJobId: null }, [
      posting('Backend Engineer, Senior'),
      posting('Office Manager'),
    ]);

    expect(match.kind).toBe('fuzzy');
    expect(match.kind === 'fuzzy' && match.score).toBeGreaterThanOrEqual(FUZZY_MIN);
  });

  it('returns none rather than the least-bad posting on the board', () => {
    const match = matchPosting({ title: 'Staff Data Scientist', atsJobId: null }, [
      posting('Office Manager'),
      posting('Account Executive'),
    ]);

    expect(match.kind).toBe('none');
  });

  it('returns none for a role that still has no real title', () => {
    // A placeholder normalises to something, and matching on it would attach
    // whichever posting happened to share a word.
    const match = matchPosting({ title: '(2024)', atsJobId: null }, [posting('Backend Engineer')]);

    expect(match.kind).toBe('none');
  });

  it('falls back to the title when the id belongs to no posting on the board', () => {
    const match = matchPosting({ title: 'Backend Engineer', atsJobId: 'stale-id' }, [
      posting('Backend Engineer', '4471'),
    ]);

    expect(match.kind).toBe('exact');
  });
});
