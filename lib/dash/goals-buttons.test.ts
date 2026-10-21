import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';

/**
 * Each Goals tool writes the rows its button writes (plan #2473.5). The
 * button's own server action runs on one copy of the person's rows, the tool
 * on another, from the same input, and the two copies are compared. Another
 * account's rows sit beside them, as they do for the connector's service
 * role, and neither side may touch them.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const ME = '00000000-0000-4000-8000-0000000000aa';
const THEM = '00000000-0000-4000-8000-0000000000bb';

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));

vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));
vi.mock('@/lib/goals/auth/server', async () => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return { createGoalsClient: async () => fake(state.tables)('goals') };
});

const areaPage = await import('@/app/goals/actions');
const goalPage = await import('@/app/goals/[goalId]/actions');
const blockPage = await import('@/app/goals/[goalId]/block-actions');
const { GOALS_WRITES, runGoalsWrite } = await import('./goals-writes');

const HEALTH = '11111111-1111-4111-8111-111111111111';
const MUSIC = '22222222-2222-4222-8222-222222222222';
const THEIRS = '33333333-3333-4333-8333-333333333333';
const GOAL = '44444444-4444-4444-8444-444444444444';
const STEP = '66666666-6666-4666-8666-666666666666';
const STEP_2 = '77777777-7777-4777-8777-777777777777';
const THEIR_STEP = '88888888-8888-4888-8888-888888888888';

const area = (id: string, name: string, position: number, fields: Record<string, unknown> = {}) => ({
  id,
  user_id: ME,
  name,
  note: null,
  position,
  archived_at: null,
  created_at: `2026-01-0${position}T00:00:00Z`,
  ...fields,
});

const item = (id: string, title: string, position: number, fields: Record<string, unknown> = {}) => ({
  id,
  user_id: ME,
  level: 'step',
  area_id: HEALTH,
  parent_id: GOAL,
  title,
  status: 'open',
  position,
  kind: 'mine',
  block_ask: null,
  block_kind: null,
  archived_at: null,
  created_at: `2026-02-0${position}T00:00:00Z`,
  ...fields,
});

function seed(): FakeTables {
  return {
    'goals.areas': [area(HEALTH, 'Health', 10), area(MUSIC, 'Music', 20), area(THEIRS, 'Theirs', 15, { user_id: THEM })],
    'goals.items': [
      item(GOAL, 'Run a half marathon', 10, { level: 'goal', parent_id: null }),
      item(STEP, 'Buy shoes', 10),
      item(STEP_2, 'Run 5k', 20),
      item(THEIR_STEP, 'Not mine', 15, { user_id: THEM }),
    ],
    'goals.item_goals': [],
    'goals.dependencies': [],
  };
}

function twins(): [FakeTables, FakeTables] {
  return [seed(), seed()];
}

async function press<T>(tables: FakeTables, act: () => Promise<T>): Promise<T> {
  state.tables = tables;
  return act();
}

async function tool(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const db = fakeSchemaDb(tables);
  const goals = db('goals');
  const write = GOALS_WRITES.find((entry) => entry.name === name)!;
  const made = await runGoalsWrite(
    write,
    { userId: ME, goals, write: async () => goals as unknown as GoalsSupabaseClient, core: db('core'), today: '2026-10-14' },
    input,
  );
  if ('ok' in made) throw new Error(made.error);
  return made;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('the Goals tools write what their buttons write', () => {
  it('change_goal_area move_down moves the area as the arrow does, and leaves another account alone', async () => {
    const [page, dash] = twins();
    await press(page, () => areaPage.moveAreaAction(form({ id: HEALTH, direction: 'down' })));
    await tool('change_goal_area', dash, { change: 'move_down', area: HEALTH });
    expect(dash['goals.areas']).toEqual(page['goals.areas']);
    expect(dash['goals.areas'].map((a) => [a.name, a.position])).toEqual([
      ['Health', 20],
      ['Music', 10],
      ['Theirs', 15],
    ]);
  });

  it('change_goal_step move_down moves the step as the arrow does, and leaves another account alone', async () => {
    const [page, dash] = twins();
    await press(page, () => goalPage.moveStepAction(form({ id: STEP, direction: 'down' })));
    await tool('change_goal_step', dash, { change: 'move_down', step_ref: STEP });
    expect(dash['goals.items']).toEqual(page['goals.items']);
    expect(dash['goals.items'].map((i) => [i.title, i.position])).toEqual([
      ['Run a half marathon', 10],
      ['Buy shoes', 20],
      ['Run 5k', 10],
      ['Not mine', 15],
    ]);
  });

  it('change_goal_step block blocks the step as the Needs line does', async () => {
    const [page, dash] = twins();
    const needs = 'The race entry to open';
    expect(await press(page, () => blockPage.blockGoalStep({}, form({ id: STEP, ask: needs, kind: 'outside' })))).toMatchObject({
      message: 'Blocked.',
    });
    await tool('change_goal_step', dash, { change: 'block', step_ref: STEP, needs, block_kind: 'outside' });
    expect(dash['goals.items']).toEqual(page['goals.items']);
    expect(dash['goals.items'].find((i) => i.id === STEP)).toMatchObject({ status: 'blocked', block_ask: needs, block_kind: 'outside' });
  });
});
