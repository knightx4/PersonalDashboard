import { describe, expect, it } from 'vitest';
import type { RequirementMatch } from '../evidence/match-payload';
import type { PastApplication } from './history';
import { chanceReason, fitReason, jobLevel, levelAgainstHistory, type ScoreReasonInput } from './reasons';

const sure = (value: number) => ({ value, confidence: 0.9 });

function app(id: string, title: string, status: string, hasInterview = false): PastApplication {
  return { id, title, company: 'Acme', status, rejectionStage: null, hasInterview };
}

function match(verdict: RequirementMatch['verdict'], kind: RequirementMatch['kind'] = 'must_have'): RequirementMatch {
  return { requirement: 'x', kind, verdict, evidenceItemId: verdict === 'gap' ? null : 'e', why: '' };
}

const base: ScoreReasonInput = {
  kind: 'opening',
  title: 'Senior Financial Analyst',
  scores: { fit_score: sure(60), chance: sure(40) },
  history: [],
};

const many = (count: number, title: string) => Array.from({ length: count }, (_, i) => app(`${title}-${i}`, title, 'rejected'));

const words = (line: string | null) => (line ?? '').split(/\s+/).filter(Boolean).length;

describe('fitReason', () => {
  it('counts must-haves met when the match has run', () => {
    const line = fitReason({
      ...base,
      kind: 'application',
      requirementMatches: [match('strong'), match('strong'), match('partial'), match('gap'), match('strong', 'nice_to_have')],
    });
    expect(line).toBe('2 of 4 must-haves met by your evidence, 1 partly');
  });

  it('counts all requirements when none is a must-have', () => {
    const line = fitReason({ ...base, kind: 'application', requirementMatches: [match('strong', 'responsibility'), match('gap', 'responsibility')] });
    expect(line).toBe('1 of 2 requirements met by your evidence');
  });

  it('names a level above or below most of the applications sent', () => {
    expect(fitReason({ ...base, title: 'Director of Finance', history: many(6, 'Financial Analyst') })).toBe(
      'Director level, above most of your applications',
    );
    expect(fitReason({ ...base, title: 'Finance Analyst', kind: 'application', seniority: 'entry', history: many(6, 'Finance Director') })).toBe(
      'Entry level, below most of your applications',
    );
  });

  it('uses the fit label for an opening when Jev was sure of it', () => {
    expect(fitReason({ ...base, scores: { ...base.scores, fit: { value: 'strong', confidence: 0.95 } } })).toBe(
      'Several of your evidence items speak to the core of the job',
    );
  });

  it('uses the fit figure when there is no label', () => {
    expect(fitReason({ ...base, kind: 'application', hasDescription: true, scores: { fit_score: sure(75) } })).toBe(
      'Direct evidence covers most of the core of the job',
    );
  });

  it('says how little the score rests on', () => {
    expect(fitReason({ ...base, scores: { fit_score: { value: 50, confidence: 0.4 } } })).toBe(
      "Unsure, read from Dash's short summary of the opening",
    );
    expect(
      fitReason({ ...base, scores: { fit: { value: 'partial', confidence: 0.5 }, fit_score: { value: 50, confidence: 0.4 } } }),
    ).toBe("Probably a partial match, from Dash's short summary alone");
    expect(fitReason({ ...base, kind: 'application', hasDescription: false, scores: { fit_score: sure(50) } })).toBe(
      'Read from the title and level only, no description on file',
    );
  });

  it('is null with no fit answer', () => {
    expect(fitReason({ ...base, scores: { chance: sure(20) } })).toBeNull();
  });
});

describe('chanceReason', () => {
  const history = [
    app('a1', 'Financial Analyst', 'rejected'),
    app('a2', 'Senior Financial Analyst', 'in_process'),
    app('a3', 'FP&A Analyst', 'submitted'),
    app('a4', 'Marketing Manager', 'offer'),
  ];

  it('counts similar applications that reached an interview, and those still waiting', () => {
    expect(chanceReason({ ...base, history })).toBe('1 of 2 similar applications reached an interview');
    expect(chanceReason({ ...base, title: 'Senior Financial Analyst', history: [...history, app('a5', 'Financial Analyst II', 'acknowledged')] })).toBe(
      '1 of 3 similar reached an interview, 1 still waiting',
    );
  });

  it('leaves the application out of its own history', () => {
    expect(chanceReason({ ...base, kind: 'application', excludeId: 'a2', history })).toBe(
      '0 of 1 similar application reached an interview',
    );
  });

  it('puts a red flag or a level above the targets first', () => {
    expect(chanceReason({ ...base, history, scores: { ...base.scores, red_flags: { value: true, confidence: 0.9 } } })).toBe(
      'Red flags in the posting, 1 of 2 similar reached an interview',
    );
    expect(
      chanceReason({ ...base, title: 'Head of Financial Planning', history: [...many(5, 'Financial Analyst'), app('b', 'Financial Planning Lead', 'rejected')] }),
    ).toBe('Above your usual level, 0 of 1 similar reached an interview');
  });

  it('falls back to the whole record when nothing similar is on file', () => {
    expect(chanceReason({ ...base, history: [app('m', 'Marketing Manager', 'offer'), app('n', 'Sales Rep', 'rejected')] })).toBe(
      'No similar applications yet, 1 of 2 overall reached an interview',
    );
  });

  it('says there is nothing to compare when little is known', () => {
    expect(chanceReason(base)).toBe('No past applications to compare against yet');
    expect(chanceReason({ ...base, kind: 'application', hasDescription: false })).toBe(
      'No past applications to compare, and no description on file',
    );
  });

  it('is null with no chance answer', () => {
    expect(chanceReason({ ...base, scores: { fit_score: sure(40) } })).toBeNull();
  });
});

describe('every line', () => {
  it('stays at twelve words or fewer', () => {
    const lines = [
      fitReason({ ...base, kind: 'application', requirementMatches: Array.from({ length: 12 }, () => match('partial')) }),
      fitReason({ ...base, scores: { fit: { value: 'partial', confidence: 0.9 } } }),
      fitReason({ ...base, scores: { fit: { value: 'weak', confidence: 0.9 } } }),
      ...[0, 25, 50, 75, 100].map((value) => fitReason({ ...base, kind: 'application', hasDescription: true, scores: { fit_score: sure(value) } })),
      fitReason({ ...base, kind: 'application', hasDescription: true, scores: { fit_score: { value: 10, confidence: 0.2 } } }),
      chanceReason({
        ...base,
        title: 'Head of Financial Planning',
        scores: { chance: sure(20), red_flags: { value: true, confidence: 0.9 } },
        history: Array.from({ length: 120 }, (_, i) => app(`h${i}`, 'Financial Planning Lead', 'submitted')),
      }),
    ];
    for (const line of lines) {
      expect(line).not.toBeNull();
      expect(words(line)).toBeLessThanOrEqual(12);
    }
  });
});

describe('levels', () => {
  it('prefers the stored seniority, then a sure answer, then the title', () => {
    expect(jobLevel({ title: 'Analyst', scores: {}, seniority: 'Senior' })).toBe('senior');
    expect(jobLevel({ title: 'Analyst', scores: { seniority: { value: 'mid', confidence: 0.9 } } })).toBe('mid');
    expect(jobLevel({ title: 'Analyst', scores: { seniority: { value: 'mid', confidence: 0.3 } } })).toBe('entry');
  });

  it('needs five sent applications to say what is usual', () => {
    expect(levelAgainstHistory('executive', many(4, 'Financial Analyst'))).toBeNull();
    expect(levelAgainstHistory('executive', [...many(4, 'Financial Analyst'), app('d', 'Analyst', 'drafting')])).toBeNull();
    expect(levelAgainstHistory('executive', many(5, 'Financial Analyst'))).toBe('above');
    expect(levelAgainstHistory('mid', [...many(3, 'Financial Analyst'), ...many(3, 'Finance Director')])).toBe('within');
  });
});
