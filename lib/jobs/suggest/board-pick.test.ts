import { describe, expect, it } from 'vitest';
import { BOARD_CANDIDATE_LIMIT, pickBoardCandidates, type BoardPosting } from './board-pick';
import { exclusionWords, roleKey } from './payload';

const posting = (title: string, over: Partial<BoardPosting> = {}): BoardPosting => ({
  company: 'Acme',
  industry: 'payments',
  title,
  url: `https://boards.example/${encodeURIComponent(title)}`,
  location: 'New York',
  ...over,
});

const rules = {
  targetTitles: ['Strategic Finance Manager'],
  likedTitles: ['FP&A Analyst'],
  taken: { urls: new Set<string>(), roles: new Set<string>(), companies: new Set<string>() },
  excludedWords: [] as string[],
};

describe('pickBoardCandidates', () => {
  it('keeps postings like a target title or a liked role, targets first', () => {
    const out = pickBoardCandidates(
      [posting('Software Engineer'), posting('Senior FP&A Analyst'), posting('Strategic Finance Manager')],
      rules,
    );
    expect(out.map((p) => p.title)).toEqual(['Strategic Finance Manager', 'Senior FP&A Analyst']);
  });

  it('leaves out what is on file, turned down or excluded', () => {
    const out = pickBoardCandidates(
      [
        posting('Strategic Finance Manager'),
        posting('Finance Manager', { company: 'Bolt' }),
        posting('Strategic Finance Lead', { company: 'Coin', industry: 'crypto exchange' }),
      ],
      {
        ...rules,
        taken: {
          urls: new Set<string>(),
          roles: new Set([roleKey('Acme', 'Strategic Finance Manager')]),
          companies: new Set(['bolt']),
        },
        excludedWords: exclusionWords(['crypto']),
      },
    );
    expect(out).toEqual([]);
  });

  it('reads nothing without a title to match and caps the list', () => {
    expect(pickBoardCandidates([posting('Finance Manager')], { ...rules, targetTitles: [], likedTitles: [] })).toEqual([]);
    const many = Array.from({ length: BOARD_CANDIDATE_LIMIT + 10 }, (_, i) => posting(`Finance Manager ${i}`));
    expect(pickBoardCandidates(many, rules)).toHaveLength(BOARD_CANDIDATE_LIMIT);
  });
});
