import { describe, expect, it, vi } from 'vitest';
import {
  APPLICATION_JD_CHARS,
  applicationState,
  isOpenApplication,
  parseApplicationScores,
  payLine,
  scoreApplication,
  type ApplicationText,
} from './application-scores';
import { scoreApplicationsFor } from './score-run';
import type { ScoringContext } from './scores';

const APP: ApplicationText = {
  id: 'a1',
  status: 'acknowledged',
  title: 'Senior Analyst, FP&A',
  company: 'Ramp',
  seniority: null,
  location: 'New York',
  workMode: 'hybrid',
  compMinCents: 15_000_000,
  compMaxCents: 18_000_000,
  requirements: [{ text: 'Three years of FP&A', kind: 'must_have' }],
  requirementMatches: [
    { requirement: 'Three years of FP&A', kind: 'must_have', verdict: 'strong', evidenceItemId: 'e1', why: 'Four years at Acme.' },
  ],
  jdText: 'x'.repeat(APPLICATION_JD_CHARS + 500),
};

const CONTEXT: ScoringContext = {
  evidence: ['Built the forecast model'],
  targetTitles: ['FP&A'],
  applied: [],
  roles: [],
  history: [
    { id: 'a1', title: 'Senior Analyst, FP&A', company: 'Ramp', status: 'acknowledged', rejectionStage: null, hasInterview: false },
    { id: 'a2', title: 'Senior Analyst, FP&A', company: 'Brex', status: 'rejected', rejectionStage: 'hiring_manager', hasInterview: false },
  ],
};

describe('isOpenApplication', () => {
  it('scores every status but the four closed ones', () => {
    for (const status of ['lead', 'drafting', 'submitted', 'acknowledged', 'in_process', 'final_round', 'offer']) {
      expect(isOpenApplication(status)).toBe(true);
    }
    for (const status of ['rejected', 'withdrawn', 'ghosted', 'role_closed']) {
      expect(isOpenApplication(status)).toBe(false);
    }
  });
});

describe('payLine', () => {
  it('reads a range, one end, or nothing', () => {
    expect(payLine(15_000_000, 18_000_000)).toBe('$150,000 to $180,000');
    expect(payLine(15_000_000, null)).toBe('from $150,000');
    expect(payLine(null, null)).toBeNull();
  });
});

describe('applicationState', () => {
  it('carries the role, the verdicts and the start of the description', () => {
    const state = applicationState(APP, CONTEXT);
    const role = state.role as Record<string, unknown>;
    expect(role.level).toBe('Mid level');
    expect(role.pay).toBe('$150,000 to $180,000');
    expect(role.requirements).toEqual([
      { requirement: 'Three years of FP&A', kind: 'must_have', verdict: 'strong', why: 'Four years at Acme.' },
    ]);
    expect((role.description_start as string).length).toBe(APPLICATION_JD_CHARS);
  });

  it('falls back to the extracted list when no match has run', () => {
    const role = applicationState({ ...APP, requirementMatches: null }, CONTEXT).role as Record<string, unknown>;
    expect(role.requirements).toEqual([{ requirement: 'Three years of FP&A', kind: 'must_have' }]);
  });

  it('leaves the application out of its own history', () => {
    const state = applicationState(APP, CONTEXT);
    expect(state.your_history_overall).toEqual({ applied: 1, reached_an_interview: 1, still_waiting: 0 });
  });
});

function jev() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> };
    expect(Object.keys(body.questions).sort()).toEqual(['chance', 'fit_score']);
    return new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: { fit_score: { score: 3, confidence: 0.8 }, chance: { score: 9, confidence: 0.5 } },
        usage: { input_tokens: 2500, output_tokens: 0 },
      }),
    );
  }) as unknown as typeof fetch;
}

describe('scoreApplication', () => {
  it('asks fit and chance and keeps each readable answer', async () => {
    const result = await scoreApplication({ application: APP, context: CONTEXT, apiKey: 'k', fetch: jev() });
    expect(result).toEqual({ ok: true, scores: { fit_score: { value: 75, confidence: 0.8 } } });
  });
});

describe('parseApplicationScores', () => {
  it('keeps whole numbers from 0 to 100 with a confidence', () => {
    expect(
      parseApplicationScores({ fit_score: { value: 60, confidence: 0.9 }, chance: { value: 101, confidence: 0.9 } }),
    ).toEqual({ fit_score: { value: 60, confidence: 0.9 } });
    expect(parseApplicationScores(null)).toBeNull();
  });
});

/** Just enough of the query builder to record the filters and serve rows. */
function fakeSupabase(rows: Record<string, unknown[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return builder;
    };
    for (const method of ['select', 'eq', 'not', 'is', 'order', 'limit', 'update', 'maybeSingle']) builder[method] = chain(method);
    builder.then = (resolve: (value: unknown) => void) =>
      resolve({ data: table === 'profiles' ? null : (rows[table] ?? []), error: null });
    return builder;
  };
  return { client: { from } as never, calls };
}

describe('scoreApplicationsFor', () => {
  it('reads only open, unscored applications and writes the scores back', async () => {
    const { client, calls } = fakeSupabase({
      applications: [
        {
          id: 'a1',
          status: 'acknowledged',
          roles: { title: 'Senior Analyst, FP&A', jd_text: 'Plan the budget.', companies: { name: 'Ramp' } },
        },
      ],
    });
    const outcome = await scoreApplicationsFor(client, 'u1', { apiKey: 'k', fetch: jev() });
    expect(outcome).toEqual({ scored: 1, failed: 0, stopped: null });
    expect(calls).toContainEqual({
      table: 'applications',
      method: 'not',
      args: ['status', 'in', '(rejected,withdrawn,ghosted,role_closed)'],
    });
    expect(calls).toContainEqual({ table: 'applications', method: 'is', args: ['scored_at', null] });
    const write = calls.find((call) => call.method === 'update');
    expect(write?.args[0]).toMatchObject({ scores: { fit_score: { value: 75, confidence: 0.8 } }, score_model: 'jev-1.13.0' });
  });
});
