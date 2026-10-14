import { describe, expect, it } from 'vitest';
import { GOALS_CHANGE_KINDS } from '@/lib/ask/goals-changes';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { GOALS_WRITES, runGoalsWrite, type GoalsWriteEnv } from './goals-writes';

/**
 * The area and goal changes an agent makes (plan #1894.7.1): each names one
 * row, read by its id and the person's user id first (the connector runs them
 * with no row level security), written as the person, and reports the values
 * its Undo needs, or why it has none.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const THEM = '00000000-0000-4000-8000-0000000000bb';
const HEALTH = '11111111-1111-4111-8111-111111111111';
const MUSIC = '22222222-2222-4222-8222-222222222222';
const OTHERS = '33333333-3333-4333-8333-333333333333';
const GOAL = '44444444-4444-4444-8444-444444444444';
const GOAL_2 = '55555555-5555-4555-8555-555555555555';
const STEP = '66666666-6666-4666-8666-666666666666';

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

const goal = (id: string, title: string, position: number, fields: Record<string, unknown> = {}) => ({
  id,
  user_id: ME,
  level: 'goal',
  area_id: HEALTH,
  parent_id: null,
  title,
  status: 'open',
  position,
  due_on: null,
  due_precision: 'day',
  errand: false,
  archived_at: null,
  created_at: `2026-02-0${position}T00:00:00Z`,
  ...fields,
});

function tables(): FakeTables {
  return {
    'goals.areas': [area(HEALTH, 'Health', 1), area(MUSIC, 'Music', 2), area(OTHERS, 'Health', 1, { user_id: THEM })],
    'goals.items': [
      goal(GOAL, 'Run a half marathon', 1),
      goal(GOAL_2, 'Sleep eight hours', 2),
      goal(STEP, 'Buy shoes', 3, { level: 'step', parent_id: GOAL }),
    ],
  };
}

function env(data: FakeTables, histories: unknown[] = []): GoalsWriteEnv {
  const db = fakeSchemaDb(data);
  const goals = db('goals');
  return {
    userId: ME,
    goals,
    write: async (history) => {
      histories.push(history);
      return goals as unknown as GoalsSupabaseClient;
    },
  };
}

const write = (name: string) => GOALS_WRITES.find((entry) => entry.name === name)!;

async function made(name: string, data: FakeTables, input: Record<string, unknown>, histories?: unknown[]) {
  const result = await runGoalsWrite(write(name), env(data, histories), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(name: string, data: FakeTables, input: Record<string, unknown>) {
  const result = await runGoalsWrite(write(name), env(data), input);
  if (!('ok' in result)) throw new Error(`expected a refusal, got ${result.summary}`);
  return result.error;
}

const row = (data: FakeTables, table: string, id: string) => data[table]!.find((r) => r.id === id)!;

describe('the Goals writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(GOALS_WRITES.map((entry) => entry.name)).toEqual([...GOALS_CHANGE_KINDS]);
  });

  describe('change_goal_area', () => {
    it('adds an area at the end of theirs, written as the person', async () => {
      const data = tables();
      const histories: unknown[] = [];
      const change = await made('change_goal_area', data, { change: 'add', name: 'Work' }, histories);
      expect(change.op).toBe('insert');
      expect(change.summary).toBe('Dash added the area Work to Goals.');
      expect(change.after).toMatchObject({ name: 'Work', user_id: ME, position: 12 });
      expect(histories).toEqual([{}]);
      expect(await refused('change_goal_area', data, { change: 'add', name: 'music' })).toBe(
        'They have an area called "music" already.',
      );
    });

    it('renames an area named by its name, and keeps the row as it was', async () => {
      const data = tables();
      const change = await made('change_goal_area', data, { change: 'rename', area: 'health', name: 'Fitness' });
      expect(change.subjectRef).toBe(`goals.areas:${HEALTH}`);
      expect(change.before).toMatchObject({ name: 'Health' });
      expect(change.after).toMatchObject({ name: 'Fitness' });
      expect(change.undo).toBeNull();
      expect(row(data, 'goals.areas', OTHERS).name).toBe('Health');
    });

    it("refuses an area that is not the person's, by ref", async () => {
      expect(await refused('change_goal_area', tables(), { change: 'rename', area: OTHERS, name: 'Mine now' })).toMatch(
        /They have no area called/,
      );
    });

    it('writes and clears what they want from an area', async () => {
      const data = tables();
      const set = await made('change_goal_area', data, { change: 'note', area: MUSIC, note: 'Play live twice' });
      expect(set.after).toMatchObject({ note: 'Play live twice' });
      const cleared = await made('change_goal_area', data, { change: 'note', area: MUSIC, note: '' });
      expect(cleared.after).toMatchObject({ note: null });
      expect(cleared.summary).toBe('Dash cleared the note on the area Music.');
    });

    it("moves an area among the person's own, saying why it has no Undo", async () => {
      const data = tables();
      const change = await made('change_goal_area', data, { change: 'move_up', area: 'Music' });
      expect(row(data, 'goals.areas', MUSIC).position).toBe(10);
      expect(row(data, 'goals.areas', HEALTH).position).toBe(20);
      expect(row(data, 'goals.areas', OTHERS).position).toBe(1);
      expect(change.undo).toEqual({ none: expect.stringContaining('reorders the areas beside it') });
      expect(await refused('change_goal_area', tables(), { change: 'move_down', area: 'Music' })).toBe('That area is last already.');
    });

    it('archives an area with its goals, and restores both', async () => {
      const data = tables();
      const archived = await made('change_goal_area', data, { change: 'archive', area: 'Health' });
      expect(archived.undo).toEqual({ none: expect.stringContaining('restore the area') });
      expect(row(data, 'goals.areas', HEALTH).archived_at).not.toBeNull();
      expect(row(data, 'goals.items', GOAL).archived_at).not.toBeNull();
      expect(await refused('change_goal_area', data, { change: 'archive', area: 'Health' })).toMatch(/no area called "Health"/);

      const restored = await made('change_goal_area', data, { change: 'restore', area: 'Health' });
      expect(restored.summary).toBe('Dash restored the area Health and the goals archived with it.');
      expect(row(data, 'goals.areas', HEALTH).archived_at).toBeNull();
      expect(row(data, 'goals.items', GOAL).archived_at).toBeNull();
    });
  });

  describe('change_goal', () => {
    it('rewords a goal, dates it and moves it to another area in one edit', async () => {
      const data = tables();
      const histories: unknown[] = [];
      const change = await made(
        'change_goal',
        data,
        { change: 'edit', goal_ref: GOAL, title: 'Run a marathon', due_on: '2027-04-30', area: 'Music' },
        histories,
      );
      expect(change.op).toBe('update');
      expect(change.subjectRef).toBe(`goals.items:${GOAL}`);
      expect(change.before).toMatchObject({ title: 'Run a half marathon', area_id: HEALTH });
      expect(change.after).toMatchObject({ title: 'Run a marathon', due_on: '2027-04-30', area_id: MUSIC });
      expect(change.summary).toBe(
        'Dash changed the goal "Run a half marathon": reworded it to "Run a marathon", set it due by 2027-04-30 and moved it to Music.',
      );
      expect(histories).toEqual([{}]);
    });

    it('refuses a practice for a title, an edit that changes nothing and a step', async () => {
      const data = tables();
      expect(await refused('change_goal', data, { change: 'edit', goal_ref: GOAL, title: 'Run every morning' })).toMatch(
        /reads like a practice/,
      );
      expect(await refused('change_goal', data, { change: 'edit', goal_ref: GOAL, area: 'Health' })).toMatch(/Nothing to change/);
      expect(await refused('change_goal', data, { change: 'close', goal_ref: STEP })).toBe('That is a step, not a goal.');
    });

    it("refuses a goal that is not the person's", async () => {
      const data = tables();
      row(data, 'goals.items', GOAL).user_id = THEM;
      expect(await refused('change_goal', data, { change: 'archive', goal_ref: GOAL })).toBe(
        'There is no goal of theirs with that ref. Look it up first.',
      );
    });

    it('moves a goal within its area, saying why it has no Undo', async () => {
      const data = tables();
      const change = await made('change_goal', data, { change: 'move_down', goal_ref: GOAL });
      expect(row(data, 'goals.items', GOAL_2).position).toBe(10);
      expect(row(data, 'goals.items', GOAL).position).toBe(20);
      expect(change.undo).toEqual({ none: expect.stringContaining('reorders the goals beside it') });
    });

    it('archives a goal and restores it, each undone from its one row', async () => {
      const data = tables();
      const archived = await made('change_goal', data, { change: 'archive', goal_ref: GOAL });
      expect(archived.after).toMatchObject({ archived_at: expect.any(String) });
      expect(archived.undo).toBeNull();
      expect(await refused('change_goal', data, { change: 'close', goal_ref: GOAL })).toBe('That goal is archived. Restore it first.');
      const restored = await made('change_goal', data, { change: 'restore', goal_ref: GOAL });
      expect(restored.after).toMatchObject({ archived_at: null });
    });

    it('closes, parks and reopens a goal from the states each starts from', async () => {
      const data = tables();
      const closed = await made('change_goal', data, { change: 'close', goal_ref: GOAL });
      expect(closed.after).toMatchObject({ status: 'done' });
      expect(await refused('change_goal', data, { change: 'park', goal_ref: GOAL })).toBe(
        'That goal is closed, so it cannot be parked.',
      );
      const reopened = await made('change_goal', data, { change: 'reopen', goal_ref: GOAL });
      expect(reopened.after).toMatchObject({ status: 'open' });
      const parked = await made('change_goal', data, { change: 'park', goal_ref: GOAL });
      expect(parked.summary).toBe('Dash parked the goal "Run a half marathon". It is taken back up from All goals.');
    });
  });
});
