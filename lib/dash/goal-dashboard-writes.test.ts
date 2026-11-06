import { describe, expect, it } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { GOALS_WRITES, runGoalsWrite, type GoalsWriteEnv } from './goals-writes';

/**
 * change_goal_dashboard (plan #2778.9): a tile asked for in words, saved
 * through the same check as the page, recorded with the dashboard column
 * alone so its Undo puts back the layout and nothing else.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const THEM = '00000000-0000-4000-8000-0000000000bb';
const GOAL = '44444444-4444-4444-8444-444444444444';
const THEIR_GOAL = '55555555-5555-4555-8555-555555555555';
const STEP = '66666666-6666-4666-8666-666666666666';
const LIST = '77777777-7777-4777-8777-777777777777';
const THEIR_STEP = '88888888-8888-4888-8888-888888888888';

const item = (id: string, title: string, fields: Record<string, unknown> = {}) => ({
  id,
  user_id: ME,
  level: 'goal',
  parent_id: null,
  title,
  status: 'open',
  position: 0,
  archived_at: null,
  dashboard: null,
  ...fields,
});

function tables(dashboard: unknown = null): FakeTables {
  return {
    'goals.items': [
      item(GOAL, 'Pay off the loans', { dashboard }),
      item(THEIR_GOAL, 'Not mine', { user_id: THEM }),
      item(STEP, 'Set up autopay on every loan', { level: 'step', parent_id: GOAL, due_on: '2026-12-01' }),
      item(THEIR_STEP, 'Set up autopay', { level: 'step', parent_id: THEIR_GOAL, user_id: THEM }),
    ],
    'goals.collections': [
      {
        id: LIST,
        user_id: ME,
        goal_id: GOAL,
        name: 'Loans',
        position: 0,
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'balance', label: 'Balance', type: 'money', tracked: true },
          { key: 'paid_off', label: 'Paid off', type: 'yes_no' },
        ],
        archived_at: null,
      },
    ],
    'goals.metrics': [],
  };
}

function env(data: FakeTables): GoalsWriteEnv {
  const goals = fakeSchemaDb(data)('goals');
  return { userId: ME, goals, write: async () => goals as unknown as GoalsSupabaseClient, today: '2026-11-04', timezone: 'UTC' };
}

const write = GOALS_WRITES.find((entry) => entry.name === 'change_goal_dashboard')!;

async function made(data: FakeTables, input: Record<string, unknown>) {
  const result = await runGoalsWrite(write, env(data), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(data: FakeTables, input: Record<string, unknown>) {
  const result = await runGoalsWrite(write, env(data), input);
  if (!('ok' in result)) throw new Error(`expected a refusal, got ${result.summary}`);
  return result.error;
}

const layout = (data: FakeTables) => data['goals.items']!.find((r) => r.id === GOAL)!.dashboard;

describe('change_goal_dashboard', () => {
  it('refuses another account goal and a step', async () => {
    const data = tables();
    const tile = { type: 'rooms' };
    expect(await refused(data, { change: 'add_tile', goal_ref: THEIR_GOAL, tile })).toMatch(/no goal of theirs/);
    expect(await refused(data, { change: 'add_tile', goal_ref: STEP, tile })).toMatch(/no goal of theirs/);
  });

  it('adds a tile named in words, turning the list and field names into ids, and keeps only the dashboard for Undo', async () => {
    const data = tables();
    const result = await made(data, {
      change: 'add_tile',
      goal_ref: GOAL,
      tile: { type: 'chart', style: 'line', list: 'loans', field: 'Balance' },
    });
    expect(layout(data)).toEqual([{ type: 'chart', style: 'line', list: LIST, field: 'balance' }]);
    expect(result.summary).toBe('Dash added a chart of Balance on Loans to the dashboard of the goal "Pay off the loans".');
    expect(result.op).toBe('update');
    expect(result.subjectRef).toBe(`goals.items:${GOAL}`);
    expect(result.before).toEqual({ dashboard: null });
    expect(result.after).toEqual({ dashboard: [{ type: 'chart', style: 'line', list: LIST, field: 'balance' }] });
  });

  it('refuses a tile whose list, step or field is not on the goal, saying what is', async () => {
    const data = tables();
    expect(await refused(data, { change: 'add_tile', goal_ref: GOAL, tile: { type: 'table', list: 'Pantries' } })).toBe(
      'There is no list "Pantries" on this goal. The goal keeps "Loans".',
    );
    expect(await refused(data, { change: 'add_tile', goal_ref: GOAL, tile: { type: 'countdown', step: THEIR_STEP } })).toMatch(
      /No one step/,
    );
    expect(await refused(data, { change: 'add_tile', goal_ref: GOAL, tile: { type: 'chart', style: 'line', list: 'Loans', field: 'Name' } })).toMatch(
      /Name is not a tracked number/,
    );
    expect(layout(data)).toBeNull();
  });

  it('counts down to a step named by its title, at the place asked for', async () => {
    const data = tables([{ type: 'rooms' }]);
    await made(data, { change: 'add_tile', goal_ref: GOAL, tile: { type: 'countdown', step: 'autopay', title: 'Autopay' }, position: 1 });
    expect(layout(data)).toEqual([{ type: 'countdown', title: 'Autopay', step: STEP }, { type: 'rooms' }]);
  });

  it('moves and takes off a tile named by its place or title', async () => {
    const data = tables([{ type: 'rooms' }, { type: 'table', title: 'The loans', list: LIST }, { type: 'number', list: LIST }]);
    const moved = await made(data, { change: 'move_tile', goal_ref: GOAL, tile: 'the loans', position: 1 });
    expect(moved.summary).toBe('Dash moved "The loans" to place 1 on the dashboard of the goal "Pay off the loans".');
    expect((layout(data) as { type: string }[]).map((t) => t.type)).toEqual(['table', 'rooms', 'number']);
    await made(data, { change: 'remove_tile', goal_ref: GOAL, tile: 3 });
    expect((layout(data) as { type: string }[]).map((t) => t.type)).toEqual(['table', 'rooms']);
    expect(await refused(data, { change: 'remove_tile', goal_ref: GOAL, tile: 'chart' })).toBe(
      'Say which tile, by its place or its title. The dashboard has 1. "The loans"; 2. the parts.',
    );
  });

  it('lays out the whole dashboard, refusing it all when one tile does not hold', async () => {
    const data = tables();
    expect(
      await refused(data, {
        change: 'set_layout',
        goal_ref: GOAL,
        tiles: [{ type: 'rooms' }, { type: 'slots', list: 'Loans', count: 3, field: 'Name' }],
      }),
    ).toMatch(/^Tile 2 \(slots\): Name is not a yes\/no field/);
    const result = await made(data, {
      change: 'set_layout',
      goal_ref: GOAL,
      tiles: [{ type: 'number', title: 'Owed', list: 'Loans', field: 'balance' }, { type: 'rooms' }],
    });
    expect(layout(data)).toEqual([{ type: 'number', title: 'Owed', list: LIST, field: 'balance' }, { type: 'rooms' }]);
    expect(result.summary).toBe('Dash laid out the dashboard of the goal "Pay off the loans" with 2 tiles.');
  });
});
