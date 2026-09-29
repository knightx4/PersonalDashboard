import { describe, expect, it, vi } from 'vitest';
import {
  duplicateByRule,
  NO_OPENING_FILTER,
  openingState,
  parseOpeningScores,
  passesFilter,
  scoreChips,
  scoreOpening,
  scaleScore,
  sortOpenings,
  type OpeningScores,
  type OpeningText,
  type ScoringContext,
} from './scores';

const OPENING: OpeningText = {
  title: 'AI Solutions Strategist',
  company: 'Ramp',
  location: 'New York, hybrid',
  why: 'Posted at $176K to $240K plus equity.',
  move: 'Open with the revenue testing tool.',
};

const CONTEXT: ScoringContext = {
  evidence: ['Automated revenue testing tool'],
  targetTitles: ['Strategic Finance'],
  applied: ['Associate, Strategic Finance at Ramp'],
  roles: [
    { title: 'Associate, Strategic Finance', company: 'Ramp Business Corp', status: 'rejected' },
    { title: 'AI Strategist', company: 'Hebbia', status: 'drafting' },
  ],
  history: [
    {
      id: 'h1',
      title: 'Associate, Strategic Finance',
      company: 'Ramp Business Corp',
      status: 'rejected',
      rejectionStage: 'resume_review',
      hasInterview: false,
    },
  ],
};

/** A stubbed Jev answering all ten questions. */
function jev() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> };
    expect(Object.keys(body.questions)).toHaveLength(10);
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
          fit_score: { score: 2.6, confidence: 0.7 },
          chance: { score: 1, confidence: 0.9 },
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
  it('carries the history of similar applications for the chance question', () => {
    const state = openingState({ ...OPENING, title: 'Strategic Finance Associate' }, CONTEXT);
    expect(state.your_history_with_similar_roles).toEqual({
      applied: 1,
      reached_an_interview: 0,
      still_waiting: 0,
      examples: ['Associate, Strategic Finance at Ramp Business Corp: rejected at resume review'],
    });
    expect(state.your_history_overall).toEqual({ applied: 1, reached_an_interview: 0, still_waiting: 0 });
  });
});

describe('duplicateByRule', () => {
  it('says no when nothing is on file at the company', () => {
    expect(duplicateByRule({ ...OPENING, company: 'Pigment' }, CONTEXT)).toEqual({ value: false, confidence: 1 });
  });
  it('says yes for the same title at the same company', () => {
    expect(duplicateByRule({ ...OPENING, company: 'Hebbia', title: 'AI  strategist' }, CONTEXT)).toEqual({
      value: true,
      confidence: 1,
    });
  });
  it('leaves a different title at the same company to Jev', () => {
    expect(duplicateByRule(OPENING, CONTEXT)).toBeNull();
  });
});

describe('scoreOpening', () => {
  it('asks the ten questions in one request and keeps every readable answer', async () => {
    const spend = vi.fn();
    const result = await scoreOpening({ opening: OPENING, context: CONTEXT, apiKey: 'k', fetch: jev(), onSpend: spend });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scores.workplace).toEqual({ value: 'hybrid', confidence: 0.99 });
    expect(result.scores.salary?.value).toBe(true);
    expect(result.scores.duplicate).toEqual({ value: true, confidence: 0.4 });
    expect(result.scores.closeness).toBeUndefined();
    expect(result.scores.fit_score).toEqual({ value: 65, confidence: 0.7 });
    expect(result.scores.chance).toEqual({ value: 25, confidence: 0.9 });
    expect(spend).toHaveBeenCalledTimes(1);
  });

  it('hands back the failure when the request fails', async () => {
    const down = vi.fn(async () => new Response('down', { status: 529 })) as unknown as typeof fetch;
    const result = await scoreOpening({ opening: OPENING, context: CONTEXT, apiKey: 'k', fetch: down });
    expect(result).toMatchObject({ ok: false, reason: 'overloaded' });
  });
});

describe('scaleScore', () => {
  it('puts the weighted score on 0 to 100 by the top level', () => {
    expect(scaleScore(0, 5)).toBe(0);
    expect(scaleScore(2, 5)).toBe(50);
    expect(scaleScore(4, 5)).toBe(100);
    expect(scaleScore(1.3, 5)).toBe(33);
    expect(scaleScore(2, 4)).toBe(67);
  });
  it('holds a score outside the levels to the ends', () => {
    expect(scaleScore(-1, 5)).toBe(0);
    expect(scaleScore(7, 5)).toBe(100);
    expect(scaleScore(Number.NaN, 5)).toBe(0);
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
    row('a', '2026-09-01', { fit_score: { value: 70, confidence: 0.5 }, chance: { value: 20, confidence: 0.9 } }),
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
    // Chance is chosen by band: 20 is low, 40 is high on the #1204 edges.
    expect(keep({ minChance: 'medium' })).toEqual(['b', 'c', 'd']);
    expect(keep({ minChance: 'high' })).toEqual(['b', 'c', 'd']);
  });
});
