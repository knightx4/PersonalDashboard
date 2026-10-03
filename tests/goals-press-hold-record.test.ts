/**
 * A goals run the person starts records each step it holds (plan #1573,
 * feature #1456). Before a run reads the tree, holdActingSteps turns a Claude
 * step that acts outside the plan into a proposal; from Work on this
 * (startGoalRun) and from Send or an @dash reply (sendGoalStep) each hold is
 * now a core.dash_actions row with surface `thread`, which Home lists with an
 * Undo. The morning run's holds are covered in scheduled-dash-actions.test.ts.
 *
 * Jev and the sentence model are stood in for; everything else runs over the
 * in-memory tables of tests/stubs/fake-schema-db.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import { undoDashAction } from '@/lib/core/dash-actions';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';

vi.mock('@/lib/jev/enabled', () => ({ jevEnabledFor: vi.fn(async () => true) }));
vi.mock('@/lib/jev/decide', () => ({ decideWithJev: vi.fn(async () => ({ value: 0.95 })) }));
vi.mock('@/lib/goals/hold-acts-model', () => ({
  writeActsSentence: vi.fn(async () => 'Sends an email to the landlord.'),
}));

const { startGoalRun } = await import('@/lib/goals/shaping-store');
const { sendGoalStep } = await import('@/lib/goals/handover-store');

const USER = '11111111-1111-4111-8111-111111111111';
const routine = { id: 'trig_goals', token: 'token' };

type Row = Record<string, unknown>;

/** The person's goals client over the fake tables, with the one rpc the hold calls. */
function goalsClient(tables: FakeTables): SchemaClient {
  const db = fakeSchemaDb(tables);
  const make = (name: string) =>
    ({
      from: (table: string) => db(name).from(table),
      schema: (other: string) => make(other),
      rpc: async (fn: string, args: Row) => {
        if (fn !== 'hold_acting_step') return { data: null, error: { message: `no rpc ${fn}` } };
        const row = (tables['goals.items'] ?? []).find((r) => r.id === args.step);
        if (!row || row.acts !== null) return { data: false, error: null };
        Object.assign(row, { status: 'proposed', acts: args.sentence });
        return { data: true, error: null };
      },
    }) as unknown as SchemaClient;
  return make('goals');
}

function tree(): FakeTables {
  const base = { user_id: USER, detail: null, acceptance: null, acts: null, archived_at: null, block_kind: null };
  return {
    'goals.items': [
      { ...base, id: 'goal', level: 'goal', kind: null, status: 'open', title: 'Renew the lease', parent_id: null },
      {
        ...base,
        id: 'step-landlord',
        level: 'step',
        kind: 'claude',
        status: 'open',
        title: 'Email the landlord',
        parent_id: 'goal',
      },
    ],
    'goals.runs': [],
    'core.dash_actions': [],
  };
}

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ claude_code_session_id: 'cse_1' }), { status: 200 }));
}

function expectHoldRecord(tables: FakeTables) {
  const rows = tables['core.dash_actions'];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    user_id: USER,
    surface: 'thread',
    status: 'done',
    kind: 'hold_acting_step',
    op: 'update',
    subject_ref: 'goals.items:step-landlord',
    before_values: expect.objectContaining({ status: 'open', acts: null }),
    after_values: expect.objectContaining({ status: 'proposed' }),
  });
  expect(String(rows[0].summary)).toBe(
    'Dash turned the step "Email the landlord" into a proposal for you to approve, because it acts ' +
      'outside the plan: Sends an email to the landlord.',
  );
}

describe('starting a goal run records the steps it holds', () => {
  it('records each hold when Work on this starts the run', async () => {
    const tables = tree();
    const started = await startGoalRun({
      client: goalsClient(tables) as never,
      userId: USER,
      goal: { id: 'goal', title: 'Renew the lease' },
      routine,
      surface: 'thread',
      fetch: okFetch(),
    });

    expect(started.ok).toBe(true);
    expect(tables['goals.items'][1]).toMatchObject({ status: 'proposed' });
    expectHoldRecord(tables);
  });

  it('records each hold when a step is handed over, and Home can put it back', async () => {
    const tables = tree();
    await sendGoalStep({
      client: goalsClient(tables) as never,
      userId: USER,
      stepId: 'step-landlord',
      routine,
      surface: 'thread',
      fetch: okFetch(),
    });

    expectHoldRecord(tables);
    const [record] = tables['core.dash_actions'];
    const undone = await undoDashAction(fakeDashDeps(tables, USER), record.id as string);
    expect(undone).toMatchObject({ ok: true });
    expect(tables['goals.items'][1]).toMatchObject({ status: 'open', acts: null });
  });
});
