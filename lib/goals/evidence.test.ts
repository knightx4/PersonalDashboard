import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { dailyRunText } from './daily-run';
import {
  bearsOnQuestion,
  evidenceLines,
  evidenceSteps,
  filterEvidence,
  QUESTIONS_PER_REQUEST,
  type EvidenceItem,
  type EvidenceStep,
} from './evidence';
import { buildForest, type Step } from './steps';
import type { Goal } from './tree';

/**
 * The morning run's evidence, filtered by Jev (plan #1176). Stubbed fetch;
 * nothing reaches TypeSafe.
 */

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId: 'area',
    title: `Goal ${id}`,
    acceptance: null,
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    ...extra,
  };
}

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
    kind: 'mine',
    status: 'open',
    title: id,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    ...extra,
  };
}

const STEP = (id: string): EvidenceStep => ({
  id,
  title: `Step ${id}`,
  acceptance: null,
  goalTitle: 'Land a role',
});

const ITEM = (id: string): EvidenceItem => ({
  source: 'gmail',
  id,
  state: { kind: 'email', from: 'Kroll', subject: `Subject ${id}` },
  line: `Email ${id}`,
});

/**
 * A TypeSafe stand-in that answers each yes/no question from `probability`,
 * called with the item's subject and the question's text.
 */
function jev(probability: (subject: string, question: string) => number | null) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      state: { subject: string };
      questions: Record<string, { instructions: string }>;
    };
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(body.questions)) {
      const p = probability(body.state.subject, q.instructions);
      answers[id] = p === null ? { type: 'noul' } : { type: 'noul', noul: p };
    }
    return new Response(
      JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 1000, output_tokens: 0 } }),
    );
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('evidenceSteps', () => {
  it('lists the person\'s open steps with nothing open beneath, under open goals only', () => {
    const goals = [goal('g'), goal('closed', { status: 'done' })];
    const { byGoal } = buildForest(
      goals.map((g) => g.id),
      [
        step('leaf', 'g', { acceptance: 'Sent.' }),
        step('phase', 'g'),
        step('under-phase', 'phase'),
        step('done-under-leafy', 'leafy', { status: 'done' }),
        step('leafy', 'g'),
        step('claude', 'g', { kind: 'claude' }),
        step('done', 'g', { status: 'done' }),
        step('elsewhere', 'closed'),
      ],
    );
    expect(evidenceSteps(goals, byGoal).map((s) => s.id).sort()).toEqual(['leaf', 'leafy', 'under-phase']);
    expect(evidenceSteps(goals, byGoal).find((s) => s.id === 'leaf')).toEqual({
      id: 'leaf',
      title: 'leaf',
      acceptance: 'Sent.',
      goalTitle: 'Goal g',
    });
  });
});

describe('bearsOnQuestion', () => {
  it('names the step and its done-when, and says what does not count', () => {
    const q = bearsOnQuestion({ ...STEP('a'), title: 'Apply to Kroll', acceptance: 'Applied.' });
    expect(q.type).toBe('yes-no');
    expect(q.question).toContain('"Apply to Kroll" (done when: Applied.)');
    expect(q.question).toContain('different company, person, account or task');
  });
});

describe('filterEvidence', () => {
  it('keeps the pairs Jev does not rule out, and records what each request cost', async () => {
    const fetch = jev((subject, question) =>
      subject === 'Subject kroll' && question.includes('Step apply') ? 0.9 : 0.05,
    );
    const spend: SpendReport[] = [];
    const result = await filterEvidence({
      steps: [STEP('apply'), STEP('shelf')],
      items: [ITEM('kroll'), ITEM('newsletter')],
      apiKey: 'key',
      fetch,
      onSpend: (report) => spend.push(report),
    });
    expect(result).toEqual({
      ok: true,
      items: 2,
      matches: [{ step: STEP('apply'), items: [ITEM('kroll')] }],
    });
    // One request per item: the item is sent once with both steps' questions.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(spend).toHaveLength(2);
  });

  it('keeps an unsure pair and a malformed answer, since a dropped pair is a missed close', async () => {
    const fetch = jev((subject) => (subject === 'Subject unsure' ? 0.25 : null));
    const result = await filterEvidence({
      steps: [STEP('a')],
      items: [ITEM('unsure'), ITEM('broken')],
      apiKey: 'key',
      fetch,
    });
    expect(result.ok && result.matches[0].items.map((i) => i.id)).toEqual(['unsure', 'broken']);
  });

  it('sends the steps in batches, so one request stays well inside the token limit', async () => {
    const steps = Array.from({ length: QUESTIONS_PER_REQUEST + 5 }, (_, i) => STEP(`s${i}`));
    const fetch = jev(() => 0.01);
    const result = await filterEvidence({ steps, items: [ITEM('one')], apiKey: 'key', fetch });
    expect(result).toEqual({ ok: true, items: 1, matches: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    const sizes = fetch.mock.calls.map(
      (call) => Object.keys((JSON.parse((call[1] as RequestInit).body as string) as { questions: object }).questions).length,
    );
    expect(sizes.sort((a, b) => a - b)).toEqual([5, QUESTIONS_PER_REQUEST]);
  });

  it('fails as a whole when any request fails, so the brief never claims to have read it all', async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('overloaded', { status: 529 })
        : new Response(JSON.stringify({ answers: { s0: { noul: 0.9 } } }));
    }) as unknown as typeof globalThis.fetch;
    const result = await filterEvidence({ steps: [STEP('a')], items: [ITEM('x'), ITEM('y')], apiKey: 'key', fetch });
    expect(result).toMatchObject({ ok: false, failure: { reason: 'overloaded' } });
  });

  it('fails without a key, and the caller falls back to letting the session search', async () => {
    const result = await filterEvidence({ steps: [STEP('a')], items: [ITEM('x')], apiKey: null });
    if (!process.env.TYPESAFE_API_KEY) expect(result).toMatchObject({ ok: false, failure: { reason: 'no-key' } });
  });

  it('asks nothing when there is nothing to read', async () => {
    const fetch = jev(() => 0.9);
    expect(await filterEvidence({ steps: [], items: [ITEM('x')], apiKey: 'key', fetch })).toEqual({
      ok: true,
      items: 1,
      matches: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the evidence in the morning brief', () => {
  const review = [
    {
      id: 'g',
      title: 'Land a role',
      acceptance: null,
      lastDoneAt: null,
      quietDays: 3,
      stalled: false,
      last: null,
    },
  ];

  it('lists each step with the items that bear on it, and tells the session not to search', () => {
    const lines = evidenceLines([{ step: STEP('apply'), items: [ITEM('kroll')] }], 12);
    const text = dailyRunText({ userId: 'u', runId: 'r', steps: [], review, evidence: lines });
    expect(text).toContain('Jev read the 12 new items since the last run');
    expect(text).toContain('- "Step apply" (goals.items id apply), under the goal "Land a role":\n  - Email kroll');
    expect(text).toContain('Do not search for other evidence');
    expect(text).not.toContain('(in Jobs, Gmail, their calendar or Todo)');
  });

  it('says plainly when nothing bears on a step', () => {
    const text = dailyRunText({ userId: 'u', runId: 'r', steps: [], review, evidence: evidenceLines([], 1) });
    expect(text).toContain('Jev read the 1 new item since the last run');
    expect(text).toContain('Close no step from evidence today.');
  });

  it('goes back to searching when Jev did not filter', () => {
    const text = dailyRunText({ userId: 'u', runId: 'r', steps: [], review, evidence: null });
    expect(text).toContain('(in Jobs, Gmail, their calendar or Todo)');
    expect(text).not.toContain('Jev read');
  });
});
