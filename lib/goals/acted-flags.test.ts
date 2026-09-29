import { describe, expect, it, vi } from 'vitest';
import {
  ACTED_QUESTION,
  actedAt,
  actedCandidate,
  actedFlag,
  actedSource,
  actedState,
  resultLine,
  type ClosedStep,
} from '@/lib/goals/acted-flags';
import { flagActedRuns } from '@/lib/goals/acted-flags-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-09-29T21:00:00Z');

const sent: ClosedStep = {
  id: 'step-nelnet',
  runId: 'run-1',
  goalId: 'goal-loans',
  title: 'Ask Nelnet for the hardship forms',
  kind: 'claude',
  acts: null,
  approvedAt: null,
  result: 'Sent the request to help@nelnet.net\n\nThey reply within five working days.',
  evidence: null,
  resolution: null,
};
const researched: ClosedStep = {
  ...sent,
  id: 'step-research',
  title: 'Research typical pay for your target role',
  result: '**Strategic Finance** base pay runs about $110,000-$150,000 ([Levels](https://levels.fyi)).',
};

describe('what the check reads', () => {
  it('asks a past-tense yes/no question about what the run wrote', () => {
    expect(ACTED_QUESTION.type).toBe('yes-no');
    expect(ACTED_QUESTION.question).toMatch(/^Does what the assistant wrote when it closed this step say/);
  });

  it('reads the title and what the run wrote, leaving out what is empty', () => {
    expect(actedState({ ...sent, evidence: 'Gmail, sent 29 September.' })).toBe(
      'Step: Ask Nelnet for the hardship forms\n' +
        'Result: Sent the request to help@nelnet.net\n\nThey reply within five working days.\n' +
        'Evidence: Gmail, sent 29 September.',
    );
  });

  it('reads Claude steps only, and not one the person approved with a sentence', () => {
    expect(actedCandidate(sent)).toBe(true);
    expect(actedCandidate({ ...sent, kind: 'mine' })).toBe(false);
    expect(actedCandidate({ ...sent, acts: 'Sends the request to Nelnet.', approvedAt: '2026-09-29T10:00:00Z' })).toBe(
      false,
    );
    // A sentence nobody approved is no permission.
    expect(actedCandidate({ ...sent, acts: 'Sends the request to Nelnet.' })).toBe(true);
    expect(actedCandidate({ ...sent, result: null })).toBe(false);
  });

  it('flags at a yes of 0.5 or more', () => {
    expect(actedAt(0.5)).toBe(true);
    expect(actedAt(0.49)).toBe(false);
  });
});

describe('the flag', () => {
  it('names the step and quotes the first line of the result', () => {
    const flag = actedFlag(sent);
    expect(flag.goalId).toBe('goal-loans');
    expect(flag.title).toBe('Dash may have acted outside the plan on "Ask Nelnet for the hardship forms"');
    expect(flag.detail).toContain('with this result: "Sent the request to help@nelnet.net"');
    expect(flag.detail).toContain('Nothing has been undone.');
    expect(flag.source).toBe('goals acts check step-nelnet');
    expect(flag.title).not.toMatch(/Claude/);
  });

  it('quotes markdown as plain text, and falls back to the evidence', () => {
    expect(resultLine(researched)).toBe('Strategic Finance base pay runs about $110,000-$150,000 (Levels).');
    expect(resultLine({ ...sent, result: null, evidence: 'Booked for 3 October.' })).toBe('Booked for 3 October.');
  });
});

type Tables = {
  runs: Record<string, unknown>[];
  history: Record<string, unknown>[];
  items: Record<string, unknown>[];
};

/** Routes each table's reads to its rows and records the writes. */
function fakeClient(tables: Tables, options: { insertError?: { code: string; message: string } } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const marked: unknown[][] = [];
  const filters: Record<string, unknown[][]> = {};
  const query = (table: keyof Tables) => {
    const log: unknown[][] = [];
    filters[table] ??= [];
    let update: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      then(resolve: (value: unknown) => unknown) {
        filters[table].push(...log);
        if (update) {
          const ids = (log.find((f) => f[0] === 'in' && f[1] === 'id')?.[2] ?? []) as string[];
          marked.push(ids);
          return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(resolve);
        }
        return Promise.resolve({ data: tables[table], error: null }).then(resolve);
      },
      update(values: Record<string, unknown>) {
        update = values;
        return builder;
      },
    };
    for (const name of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'order', 'limit']) {
      builder[name] = (...args: unknown[]) => {
        log.push([name, ...args]);
        return builder;
      };
    }
    return builder;
  };
  const publicSchema = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (options.insertError) return { error: options.insertError };
        inserts.push(row);
        return { error: null };
      },
    }),
  };
  const core = { from: () => ({ insert: async () => ({ error: null }) }) };
  const client = {
    from: (table: keyof Tables) => query(table),
    schema: (name: string) => (name === 'public' ? publicSchema : core),
  } as unknown as GoalsSupabaseClient;
  return { client, inserts, marked, filters };
}

function item(step: ClosedStep, parent = 'phase-1') {
  return {
    id: step.id,
    user_id: USER,
    parent_id: parent,
    level: 'step',
    kind: step.kind,
    title: step.title,
    acts: step.acts,
    approved_at: step.approvedAt,
    result: step.result,
    evidence: step.evidence,
    resolution: step.resolution,
  };
}

const tree = [
  { id: 'goal-loans', parent_id: null, level: 'goal' },
  { id: 'phase-1', parent_id: 'goal-loans', level: 'step' },
];

function tables(steps: ClosedStep[], runIds = ['run-1']): Tables {
  return {
    runs: runIds.map((id) => ({ id, user_id: USER })),
    history: steps.map((step) => ({ run_id: step.runId, row_id: step.id, new_values: { status: 'done' } })),
    // Both items reads get the same rows; the tree read only needs the ids and levels.
    items: [...steps.map((step) => item(step)), ...tree],
  };
}

const ask = async (step: ClosedStep) => (step.id === sent.id ? 0.93 : 0.04);

describe('flagActedRuns', () => {
  it('flags the goal for a step closed with "Sent the request to help@nelnet.net" and marks the run checked', async () => {
    const { client, inserts, marked, filters } = fakeClient(tables([sent]));
    const result = await flagActedRuns({ client, now: NOW, ask, enabled: async () => true });
    expect(inserts).toEqual([
      {
        user_id: USER,
        module: 'goals',
        goal_id: 'goal-loans',
        title: 'Dash may have acted outside the plan on "Ask Nelnet for the hardship forms"',
        detail: actedFlag(sent).detail,
        ask: 'Check what was done and say whether anything needs putting right.',
        source: actedSource(sent.id),
      },
    ]);
    expect(result).toMatchObject({ runs: 1, checked: 1, unanswered: 0, flagged: [{ stepId: sent.id, probability: 0.93 }] });
    expect(marked).toEqual([['run-1']]);
    expect(filters.runs).toContainEqual(['neq', 'status', 'started']);
    expect(filters.runs).toContainEqual(['is', 'acts_checked_at', null]);
  });

  it('writes nothing for a run that only researched, and still marks it checked', async () => {
    const { client, inserts, marked } = fakeClient(tables([researched]));
    const result = await flagActedRuns({ client, now: NOW, ask, enabled: async () => true });
    expect(inserts).toEqual([]);
    expect(result).toMatchObject({ runs: 1, checked: 1, flagged: [] });
    expect(marked).toEqual([['run-1']]);
  });

  it('counts a step flagged before as done, without a second flag', async () => {
    const { client, marked } = fakeClient(tables([sent]), {
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    const result = await flagActedRuns({ client, now: NOW, ask, enabled: async () => true });
    expect(result.flagged).toEqual([]);
    expect(marked).toEqual([['run-1']]);
  });

  it('leaves a run unchecked when Jev did not answer, so the next tick asks again', async () => {
    const { client, inserts, marked } = fakeClient(tables([sent]));
    const result = await flagActedRuns({ client, now: NOW, ask: async () => null, enabled: async () => true });
    expect(inserts).toEqual([]);
    expect(result).toMatchObject({ runs: 0, unanswered: 1 });
    expect(marked).toEqual([]);
  });

  it('does not ask about a step of the person closed from evidence', async () => {
    const theirs: ClosedStep = { ...sent, id: 'step-theirs', kind: 'mine', result: null, evidence: 'Your application is in Jobs, sent 5 July.' };
    const spy = vi.fn(ask);
    const { client, marked } = fakeClient(tables([theirs]));
    await flagActedRuns({ client, now: NOW, ask: spy, enabled: async () => true });
    expect(spy).not.toHaveBeenCalled();
    expect(marked).toEqual([['run-1']]);
  });

  it('asks nothing and marks nothing for an account that has not agreed to send text to Jev', async () => {
    const spy = vi.fn(ask);
    const { client, marked } = fakeClient(tables([sent]));
    const result = await flagActedRuns({ client, now: NOW, ask: spy, enabled: async () => false });
    expect(spy).not.toHaveBeenCalled();
    expect(marked).toEqual([]);
    expect(result).toEqual({ runs: 0, checked: 0, unanswered: 0, flagged: [] });
  });
});
