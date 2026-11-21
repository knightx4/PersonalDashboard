import { describe, expect, it, vi } from 'vitest';
import {
  duplicateByRule,
  NO_OPENING_FILTER,
  openingState,
  parseOpeningScores,
  passesFilter,
  scoreChips,
  scoreOpening,
  sortOpenings,
  type OpeningScores,
  type OpeningText,
  type ScoringContext,
} from './scores';
import { CHANCE_QUESTIONS, FIT_QUESTIONS } from './rubric';
import { rubricAnswers } from './fixtures/rubric-answers';

const OPENING: OpeningText = {
  title: 'AI Solutions Strategist',
  company: 'Globex',
  location: 'New York, hybrid',
  why: 'Posted at $176K to $240K plus equity.',
  move: 'Open with the revenue testing tool.',
};

const CONTEXT: ScoringContext = {
  evidence: ['Inventory reconciliation workbook'],
  targetTitles: ['Strategic Finance'],
  applied: ['Associate, Strategic Finance at Globex'],
  roles: [
    { title: 'Associate, Strategic Finance', company: 'Globex Business Corp', status: 'rejected' },
    { title: 'AI Strategist', company: 'Initech', status: 'drafting' },
  ],
  history: [
    {
      id: 'h1',
      title: 'Associate, Strategic Finance',
      company: 'Globex Business Corp',
      status: 'rejected',
      rejectionStage: 'resume_review',
      hasInterview: false,
    },
  ],
};

/** A stubbed Jev answering the eight label questions and the rubric's factors. */
function jev(rubric: Record<string, unknown> = rubricAnswers(3)) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> };
    expect(Object.keys(body.questions)).toHaveLength(8 + Object.keys(FIT_QUESTIONS).length + Object.keys(CHANCE_QUESTIONS).length);
    return new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          workplace: { choice: 'hybrid', confidence: 0.99, probabilities: {} },
          seniority: { choice: 'senior', confidence: 0.4 },
          salary: { noul: 0.97 },
          fit: { choice: 'strong', confidence: 0.82 },
          red_flags: { noul: 0.2 },
          cover_letter: { noul: 0.1 },
          duplicate: { noul: 0.7 },
          // Out of range: this one answer is lost, the rest are kept.
          closeness: { score: 9, confidence: 0.5 },
          ...rubric,
        },
        usage: { input_tokens: 1800, output_tokens: 0 },
      }),
    );
  }) as unknown as typeof fetch;
}

describe('openingState', () => {
  it('lists only the roles on file at the same company, however it is spelled', () => {
    const state = openingState(OPENING, CONTEXT);
    expect(state.your_roles_at_this_company).toEqual(['Associate, Strategic Finance (rejected)']);
    expect(state.roles_you_applied_to).toEqual(CONTEXT.applied);
  });
  it('carries the career goals, excluded industries and interview levels for the rubric', () => {
    const state = openingState(OPENING, { ...CONTEXT, careerGoals: [' Plan work, not books ', ''], excludedIndustries: ['Crypto'] });
    expect(state.your_career_goals).toEqual(['Plan work, not books']);
    expect(state.your_excluded_industries).toEqual(['Crypto']);
    expect(state.your_interview_levels).toEqual({});
  });
  it('carries the history of similar applications for the background question', () => {
    const state = openingState({ ...OPENING, title: 'Strategic Finance Associate' }, CONTEXT);
    expect(state.your_history_with_similar_roles).toEqual({
      applied: 1,
      reached_an_interview: 0,
      still_waiting: 0,
      examples: ['Associate, Strategic Finance at Globex Business Corp: rejected at resume review'],
    });
    expect(state.your_history_overall).toEqual({ applied: 1, reached_an_interview: 0, still_waiting: 0 });
  });
});

describe('duplicateByRule', () => {
  it('says no when nothing is on file at the company', () => {
    expect(duplicateByRule({ ...OPENING, company: 'Umbrella Analytics' }, CONTEXT)).toEqual({ value: false, confidence: 1 });
  });
  it('says yes for the same title at the same company', () => {
    expect(duplicateByRule({ ...OPENING, company: 'Initech', title: 'AI  strategist' }, CONTEXT)).toEqual({
      value: true,
      confidence: 1,
    });
  });
  it('leaves a different title at the same company to Jev', () => {
    expect(duplicateByRule(OPENING, CONTEXT)).toBeNull();
  });
});

describe('scoreOpening', () => {
  it('asks every question in one request and builds fit and chance from the factors', async () => {
    const spend = vi.fn();
    const result = await scoreOpening({ opening: OPENING, context: CONTEXT, apiKey: 'k', fetch: jev(), onSpend: spend });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scores.workplace).toEqual({ value: 'hybrid', confidence: 0.99 });
    expect(result.scores.salary?.value).toBe(true);
    expect(result.scores.duplicate).toEqual({ value: true, confidence: 0.4 });
    expect(result.scores.closeness).toBeUndefined();
    // Every wanting factor at 3 of 4, pay not given: 75, pinned exactly.
    expect(result.scores.fit_score).toEqual({ value: 75, confidence: 1 });
    expect(result.scores.rubric?.fit.fit_pay).toBeUndefined();
    // One old rejection behind it: the base rate is near the 8% prior, and the
    // chance factors above their middle lift it.
    expect(result.scores.rubric?.chance.base).toBeCloseTo(0.0762, 3);
    expect(result.scores.chance?.value).toBeGreaterThan(8);
    expect(spend).toHaveBeenCalledTimes(1);
  });

  it('caps fit when the company is in an excluded industry', async () => {
    const result = await scoreOpening({
      opening: OPENING,
      context: CONTEXT,
      apiKey: 'k',
      fetch: jev(rubricAnswers(4, { fit_excluded_industry: { noul: 0.9 } })),
    });
    expect(result.ok && result.scores.fit_score?.value).toBe(15);
  });

  it('hands back the failure when the request fails', async () => {
    const down = vi.fn(async () => new Response('down', { status: 529 })) as unknown as typeof fetch;
    const result = await scoreOpening({ opening: OPENING, context: CONTEXT, apiKey: 'k', fetch: down });
    expect(result).toMatchObject({ ok: false, reason: 'overloaded' });
  });
});

describe('parseOpeningScores', () => {
  it('drops entries that do not fit their question', () => {
    expect(
      parseOpeningScores({
        workplace: { value: 'moon', confidence: 0.9 },
        fit: { value: 'strong', confidence: 0.9 },
        salary: { value: 'yes', confidence: 0.9 },
        closeness: { value: 2, confidence: 1.5 },
        fit_score: { value: 140, confidence: 0.9 },
        chance: { value: 40, confidence: 0.6 },
      }),
    ).toEqual({ fit: { value: 'strong', confidence: 0.9 }, chance: { value: 40, confidence: 0.6 } });
    expect(parseOpeningScores({ rubric: { fit: { fit_work: { score: 3, sd: 0 } }, chance: 'x' } })).toEqual({
      rubric: { fit: { fit_work: { score: 3, sd: 0 } }, chance: {} },
    });
    expect(parseOpeningScores(null)).toBeNull();
    expect(parseOpeningScores([])).toBeNull();
  });
});

describe('scoreChips', () => {
  it('names each answer and marks the unsure ones', () => {
    const chips = scoreChips({
      workplace: { value: 'remote', confidence: 0.95 },
      red_flags: { value: true, confidence: 0.5 },
    });
    expect(chips).toEqual([
      { key: 'workplace', label: 'Remote', unsure: false, tone: 'plain' },
      { key: 'red_flags', label: 'Red flags', unsure: true, tone: 'warn' },
    ]);
  });
});

describe('sorting and filtering', () => {
  const row = (id: string, createdAt: string, scores: OpeningScores | null) => ({ id, createdAt, scores });
  const rows = [
    row('a', '2026-09-01', { fit: { value: 'partial', confidence: 0.9 }, workplace: { value: 'remote', confidence: 0.9 } }),
    row('b', '2026-09-02', { fit: { value: 'strong', confidence: 0.9 }, red_flags: { value: true, confidence: 0.9 } }),
    row('c', '2026-09-03', null),
    row('d', '2026-09-04', { fit: { value: 'weak', confidence: 0.9 }, duplicate: { value: true, confidence: 1 } }),
  ];

  it('sorts by match with unscored last and newest first on a tie', () => {
    expect(sortOpenings(rows, 'fit').map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(sortOpenings(rows, 'newest').map((r) => r.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('filters by the answers and lets an unscored opening through', () => {
    const keep = (patch: Partial<typeof NO_OPENING_FILTER>) =>
      rows.filter((r) => passesFilter(r, { ...NO_OPENING_FILTER, ...patch })).map((r) => r.id);
    expect(keep({})).toEqual(['a', 'b', 'c', 'd']);
    expect(keep({ fit: 'partial_up' })).toEqual(['a', 'b', 'c']);
    expect(keep({ hideRedFlags: true, hideDuplicates: true })).toEqual(['a', 'c']);
    expect(keep({ workplace: 'remote' })).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('fit and chance on the openings (plan #1206)', () => {
  const row = (id: string, createdAt: string, scores: OpeningScores | null) => ({ id, createdAt, scores });
  const rows = [
    row('a', '2026-09-01', { fit_score: { value: 70, confidence: 0.5 }, chance: { value: 3, confidence: 0.9 } }),
    row('b', '2026-09-02', { fit_score: { value: 45, confidence: 0.9 }, chance: { value: 40, confidence: 0.9 } }),
    row('c', '2026-09-03', null),
    row('d', '2026-09-04', { fit: { value: 'strong', confidence: 0.9 } }),
  ];

  it('sorts by fit or by chance, highest first, with rows lacking the figure last', () => {
    expect(sortOpenings(rows, 'fit_score').map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(sortOpenings(rows, 'chance').map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('hides rows under a minimum and lets rows without the figure through', () => {
    const keep = (patch: Partial<typeof NO_OPENING_FILTER>) =>
      rows.filter((r) => passesFilter(r, { ...NO_OPENING_FILTER, ...patch })).map((r) => r.id);
    expect(keep({ minFit: 60 })).toEqual(['a', 'c', 'd']);
    // Chance is chosen by band: 8 is low, 40 is high on the filter edges.
    expect(keep({ minChance: 'medium' })).toEqual(['b', 'c', 'd']);
    expect(keep({ minChance: 'high' })).toEqual(['b', 'c', 'd']);
  });
});
