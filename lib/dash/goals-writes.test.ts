import { describe, expect, it, vi, onTestFinished } from 'vitest';
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
const STEP_2 = '77777777-7777-4777-8777-777777777777';
const THEIR_STEP = '88888888-8888-4888-8888-888888888888';
const TODAY = '2026-10-14';

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
      goal(STEP, 'Buy shoes', 3, { level: 'step', parent_id: GOAL, detail: null, acceptance: null, starts_on: null, kind: 'mine' }),
      goal(STEP_2, 'Run 5k', 4, { level: 'step', parent_id: GOAL, kind: 'mine' }),
      goal(THEIR_STEP, 'Not mine', 5, { level: 'step', parent_id: GOAL, user_id: THEM }),
    ],
    'goals.item_goals': [],
    'goals.dependencies': [],
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
    core: db('core'),
    today: TODAY,
    timezone: 'UTC',
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

  describe('change_goal_step', () => {
    it('edits a step in one write, as the person, and keeps the row as it was', async () => {
      const data = tables();
      const histories: unknown[] = [];
      const change = await made(
        'change_goal_step',
        data,
        { change: 'edit', step_ref: STEP, title: 'Buy trail shoes', done_when: 'Shoes in the hall', due_on: '2026-11-01' },
        histories,
      );
      expect(change.kind).toBe('change_goal_step');
      expect(change.subjectRef).toBe(`goals.items:${STEP}`);
      expect(change.before).toMatchObject({ title: 'Buy shoes' });
      expect(change.after).toMatchObject({ title: 'Buy trail shoes', acceptance: 'Shoes in the hall', due_on: '2026-11-01' });
      expect(change.summary).toBe(
        'Dash changed the step "Buy shoes": reworded it to "Buy trail shoes", set when it is done and set it due by 2026-11-01.',
      );
      expect(change.input.href).toBe(`/goals/${GOAL}/s/${STEP}`);
      expect(histories).toEqual([{}]);
      expect(await refused('change_goal_step', data, { change: 'edit', step_ref: STEP, title: 'Buy trail shoes' })).toMatch(
        /Nothing to change/,
      );
    });

    it("refuses a step that is not the person's, and a goal", async () => {
      expect(await refused('change_goal_step', tables(), { change: 'drop', step_ref: THEIR_STEP })).toMatch(/no step of theirs/);
      expect(await refused('change_goal_step', tables(), { change: 'drop', step_ref: GOAL })).toMatch(/is a goal, not a step/);
    });

    it('drops, blocks and reopens a step from the states each starts from', async () => {
      const data = tables();
      const dropped = await made('change_goal_step', data, { change: 'drop', step_ref: STEP });
      expect(dropped.after).toMatchObject({ status: 'dropped' });
      expect(await refused('change_goal_step', data, { change: 'block', step_ref: STEP, needs: 'Money' })).toBe(
        'That step is dropped, so it cannot be blocked.',
      );
      const reopened = await made('change_goal_step', data, { change: 'reopen', step_ref: STEP });
      expect(reopened.after).toMatchObject({ status: 'open' });
      expect(await refused('change_goal_step', data, { change: 'block', step_ref: STEP })).toMatch(/needs is missing/);
      const blocked = await made('change_goal_step', data, { change: 'block', step_ref: STEP, needs: 'The shop to open' });
      expect(blocked.after).toMatchObject({ status: 'blocked', block_ask: 'The shop to open', block_kind: 'outside' });
      expect(blocked.undo).toBeNull();
    });

    it("moves a step among the person's own siblings, saying why it has no Undo", async () => {
      const data = tables();
      const change = await made('change_goal_step', data, { change: 'move_down', step_ref: STEP });
      expect(row(data, 'goals.items', STEP_2).position).toBe(10);
      expect(row(data, 'goals.items', STEP).position).toBe(20);
      expect(row(data, 'goals.items', THEIR_STEP).position).toBe(5);
      expect(change.undo).toEqual({ none: expect.stringContaining('reorders the steps beside it') });
    });

    it('archives a step and restores it', async () => {
      const data = tables();
      await made('change_goal_step', data, { change: 'archive', step_ref: STEP });
      expect(await refused('change_goal_step', data, { change: 'drop', step_ref: STEP })).toBe('That step is archived. Restore it first.');
      const restored = await made('change_goal_step', data, { change: 'restore', step_ref: STEP });
      expect(restored.after).toMatchObject({ archived_at: null });
    });

    it('makes a step its own errand in the goal\'s area and archives the step (note 16a21d3a)', async () => {
      const data = tables();
      expect(await refused('change_goal_step', data, { change: 'make_errand', step_ref: STEP })).toMatch(/needs a date/);
      const change = await made('change_goal_step', data, { change: 'make_errand', step_ref: STEP, due_on: '2026-10-20' });
      const errand = data['goals.items']!.find((r) => r.errand === true)!;
      expect(errand).toMatchObject({ user_id: ME, level: 'goal', area_id: HEALTH, title: 'Buy shoes', due_on: '2026-10-20' });
      expect(row(data, 'goals.items', STEP).archived_at).not.toBeNull();
      expect(change.summary).toBe('Dash made the step "Buy shoes" its own errand in Health, due 2026-10-20, and archived the step from "Run a half marathon".');
      expect(change.input.href).toBe(`/goals/${errand.id}`);
      expect(change.undo).toEqual({ none: expect.stringContaining('Two rows changed') });
      expect(await refused('change_goal_step', data, { change: 'make_errand', step_ref: STEP })).toBe('That step is archived. Restore it first.');
    });

    it('makes an errand in a named area, on the step\'s own date', async () => {
      const data = tables();
      row(data, 'goals.items', STEP_2).due_on = '2026-11-02';
      await made('change_goal_step', data, { change: 'make_errand', step_ref: STEP_2, area: 'Music' });
      expect(data['goals.items']!.find((r) => r.errand === true)).toMatchObject({ area_id: MUSIC, due_on: '2026-11-02' });
    });

    it('counts a step towards another goal and stops it, each a link row', async () => {
      const data = tables();
      const linked = await made('change_goal_step', data, { change: 'count_towards', step_ref: STEP, goal_ref: GOAL_2 });
      expect(linked.op).toBe('insert');
      expect(linked.subjectRef).toMatch(/^goals\.item_goals:/);
      expect(data['goals.item_goals']).toHaveLength(1);
      expect(await refused('change_goal_step', data, { change: 'count_towards', step_ref: STEP, goal_ref: GOAL })).toBe(
        'That step is under that goal already.',
      );
      const unlinked = await made('change_goal_step', data, { change: 'stop_counting', step_ref: STEP, goal_ref: GOAL_2 });
      expect(unlinked.op).toBe('update');
      expect(unlinked.after).toMatchObject({ archived_at: expect.any(String) });
      const relinked = await made('change_goal_step', data, { change: 'count_towards', step_ref: STEP, goal_ref: GOAL_2 });
      expect(relinked.op).toBe('update');
      expect(relinked.after).toMatchObject({ archived_at: null });
    });

    it('makes a step wait on another and stops it, the removal undone by putting the row back', async () => {
      const data = tables();
      const waits = await made('change_goal_step', data, { change: 'wait_on', step_ref: STEP_2, other_step_ref: STEP });
      expect(waits.op).toBe('insert');
      expect(waits.after).toMatchObject({ item_id: STEP_2, depends_on_id: STEP, user_id: ME });
      expect(await refused('change_goal_step', data, { change: 'wait_on', step_ref: STEP, other_step_ref: STEP })).toBe(
        'A step cannot wait on itself.',
      );
      expect(await refused('change_goal_step', data, { change: 'wait_on', step_ref: STEP, other_step_ref: THEIR_STEP })).toMatch(
        /no step of theirs/,
      );
      const removed = await made('change_goal_step', data, { change: 'stop_waiting', step_ref: STEP_2, other_step_ref: STEP });
      expect(removed.op).toBe('delete');
      expect(removed.before).toMatchObject({ item_id: STEP_2, depends_on_id: STEP });
      expect(data['goals.dependencies']).toHaveLength(0);
    });
  });

  // plan #1894.7.3
  const LOANS = '99999999-9999-4999-8999-999999999999';
  const FORM_STEP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const AIM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const THEIR_AIM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const CHASE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const CITI = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const STATEMENT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  function formTables(): FakeTables {
    const data = tables();
    data['goals.items']!.push(
      goal(FORM_STEP, 'Gather the loans', 6, {
        level: 'step',
        parent_id: GOAL,
        kind: 'mine',
        collection_id: LOANS,
        questions: [{ key: 'total', question: 'What is the total?' }],
      }),
    );
    data['goals.collections'] = [
      {
        id: LOANS,
        user_id: ME,
        name: 'Loans',
        archived_at: null,
        fields: [
          { key: 'lender', label: 'Lender', type: 'text' },
          { key: 'balance', label: 'Balance', type: 'money' },
        ],
      },
    ];
    data['goals.collection_goals'] = [{ id: 'cg', user_id: ME, collection_id: LOANS, goal_id: GOAL, archived_at: null }];
    data['goals.records'] = [
      { id: CHASE, user_id: ME, collection_id: LOANS, data: { lender: 'Chase', balance: 1200 }, position: 1, archived_at: null },
      { id: CITI, user_id: ME, collection_id: LOANS, data: { lender: 'Citi', balance: 300 }, position: 2, archived_at: null },
    ];
    data['goals.document_kinds'] = [
      { id: STATEMENT, user_id: ME, collection_id: LOANS, name: 'Chase statement', recognise: '', senders: [], skipped: [], field_notes: { balance: 'The closing one' }, archived_at: null },
    ];
    data['goals.links'] = [];
    data['learn.aims'] = [
      { id: AIM, user_id: ME, name: 'Learn Spanish', archived_at: null },
      { id: THEIR_AIM, user_id: THEM, name: 'Learn French', archived_at: null },
    ];
    return data;
  }

  describe('change_goal_number', () => {
    it("sets a goal's unit and target, and clears them", async () => {
      const data = formTables();
      const set = await made('change_goal_number', data, { change: 'measure', goal_ref: GOAL, unit: 'km', target: 21 });
      expect(set.kind).toBe('change_goal_number');
      expect(set.summary).toBe('Dash set the goal "Run a half marathon" to be measured in km, aiming for 21.');
      expect(row(data, 'goals.items', GOAL)).toMatchObject({ unit: 'km', target: 21 });
      expect(await refused('change_goal_number', data, { change: 'measure', goal_ref: GOAL, unit: 'km', target: 21 })).toBe(
        'That goal is measured that way already.',
      );
      await made('change_goal_number', data, { change: 'measure', goal_ref: GOAL, unit: '' });
      expect(row(data, 'goals.items', GOAL)).toMatchObject({ unit: null, target: null });
    });

    it('works the number out from a collection serving the goal, refusing a choice it does not have', async () => {
      const data = formTables();
      expect(await refused('change_goal_number', data, { change: 'number_from', goal_ref: GOAL, from: 'Total pay of Jobs' })).toMatch(
        /can come from: "Total balance of Loans", "Latest balance of Loans", "Number of Loans"/,
      );
      const from = await made('change_goal_number', data, { change: 'number_from', goal_ref: GOAL, from: 'total balance of loans' });
      expect(from.subjectRef).toBe(`goals.items:${GOAL}`);
      expect(row(data, 'goals.items', GOAL)).toMatchObject({
        number_from_collection_id: LOANS,
        number_from_field: 'balance',
        number_from_how: 'sum',
        unit: '$',
      });
      expect(await refused('change_goal_number', data, { change: 'number_from', goal_ref: GOAL_2, from: 'Number of Loans' })).toBe(
        'No collection serves that goal, so its number can only be typed in.',
      );
    });
  });

  describe('change_goal_link', () => {
    it("links a goal to the person's own Learn goal by name and unlinks it", async () => {
      const data = formTables();
      expect(await refused('change_goal_link', data, { change: 'link_aim', goal_ref: GOAL, aim: 'Learn French' })).toMatch(
        /no Learn goal called "Learn French". Theirs are "Learn Spanish"/,
      );
      const linked = await made('change_goal_link', data, { change: 'link_aim', goal_ref: GOAL, aim: 'learn spanish' });
      expect(linked.op).toBe('insert');
      expect(linked.subjectRef).toMatch(/^goals\.links:/);
      expect(linked.after).toMatchObject({ item_id: GOAL, kind: 'aim', target_id: AIM, user_id: ME });
      expect(await refused('change_goal_link', data, { change: 'link_aim', goal_ref: GOAL, aim: 'Learn Spanish' })).toMatch(/already/);
      const unlinked = await made('change_goal_link', data, { change: 'unlink_aim', goal_ref: GOAL, aim: 'Learn Spanish' });
      expect(unlinked.op).toBe('update');
      expect(unlinked.after).toMatchObject({ archived_at: expect.any(String) });
    });

    it('links a goal to the job search', async () => {
      const data = formTables();
      const linked = await made('change_goal_link', data, { change: 'link_job_search', goal_ref: GOAL });
      expect(linked.summary).toBe('Dash linked the goal "Run a half marathon" to the job search.');
      expect(linked.after).toMatchObject({ kind: 'job_search', target_id: null });
      expect(await refused('change_goal_link', data, { change: 'unlink_job_search', goal_ref: GOAL_2 })).toBe(
        'That goal is not linked to the job search.',
      );
    });
  });

  describe('change_goal_form', () => {
    it('sets the questions, keeping the key of a wording already there', async () => {
      const data = formTables();
      expect(await refused('change_goal_form', data, { change: 'set_questions', step_ref: FORM_STEP })).toMatch(
        /The step asks "What is the total\?"/,
      );
      await made('change_goal_form', data, {
        change: 'set_questions',
        step_ref: FORM_STEP,
        questions: ['What is the total?', 'Which is the dearest?'],
      });
      expect(row(data, 'goals.items', FORM_STEP).questions).toEqual([
        { key: 'total', question: 'What is the total?' },
        { key: 'which_is_the_dearest', question: 'Which is the dearest?' },
      ]);
      expect(await refused('change_goal_form', data, { change: 'set_questions', step_ref: STEP, questions: [] })).toMatch(/has no form/);
    });

    it('archives a row named by its words and brings it back', async () => {
      const data = formTables();
      expect(await refused('change_goal_form', data, { change: 'archive_record', step_ref: FORM_STEP, record: 'Amex' })).toBe(
        'No row matches "Amex". The rows are "Chase, 1200", "Citi, 300".',
      );
      const archived = await made('change_goal_form', data, { change: 'archive_record', step_ref: FORM_STEP, record: 'chase' });
      expect(archived.subjectRef).toBe(`goals.records:${CHASE}`);
      expect(archived.summary).toBe('Dash archived the row "Chase, 1200" on the step "Gather the loans".');
      expect(row(data, 'goals.records', CHASE).archived_at).not.toBeNull();
      await made('change_goal_form', data, { change: 'restore_record', step_ref: FORM_STEP, record: 'Chase' });
      expect(row(data, 'goals.records', CHASE).archived_at).toBeNull();
    });

    it('adds a row to a list serving a goal by label, and changes it (note 75fdbf3d)', async () => {
      const data = formTables();
      expect(await refused('change_goal_form', data, { change: 'add_record', goal_ref: GOAL, collection: 'Spaces', values: { Lender: 'Amex' } })).toBe(
        'That goal has no collection called "Spaces". It has "Loans".',
      );
      expect(await refused('change_goal_form', data, { change: 'add_record', goal_ref: GOAL, values: { Colour: 'red' } })).toMatch(/no field/);
      const added = await made('change_goal_form', data, { change: 'add_record', goal_ref: GOAL, values: { lender: 'Amex', Balance: 50 } });
      expect(added.op).toBe('insert');
      expect(added.subjectRef).toMatch(/^goals\.records:/);
      expect(added.after).toMatchObject({ user_id: ME, collection_id: LOANS, data: { lender: 'Amex', balance: 50 }, draft: false, position: 2 });
      expect(added.summary).toBe('Dash added "Amex, 50" to Loans on "Run a half marathon".');
      const changed = await made('change_goal_form', data, { change: 'edit_record', step_ref: FORM_STEP, record: 'amex', values: { Balance: 75 } });
      expect(changed.op).toBe('update');
      expect(changed.after).toMatchObject({ data: { lender: 'Amex', balance: 75 } });
      expect(await refused('change_goal_form', data, { change: 'edit_record', step_ref: FORM_STEP, record: 'amex', values: { Balance: 75 } })).toBe(
        'That row has those values already.',
      );
    });

    it('edits a kind of document, keeping its field notes, and forgets it', async () => {
      const data = formTables();
      const edited = await made('change_goal_form', data, {
        change: 'edit_document_kind',
        step_ref: FORM_STEP,
        document_kind: 'chase statement',
        senders: ['statements@chase.com'],
      });
      expect(edited.subjectRef).toBe(`goals.document_kinds:${STATEMENT}`);
      expect(row(data, 'goals.document_kinds', STATEMENT)).toMatchObject({
        name: 'Chase statement',
        senders: ['statements@chase.com'],
        field_notes: { balance: 'The closing one' },
      });
      await made('change_goal_form', data, { change: 'forget_document_kind', step_ref: FORM_STEP, document_kind: 'Chase statement' });
      expect(row(data, 'goals.document_kinds', STATEMENT).archived_at).not.toBeNull();
      expect(await refused('change_goal_form', data, { change: 'forget_document_kind', step_ref: FORM_STEP, document_kind: 'Chase statement' })).toBe(
        'That form has learned no kinds of document yet.',
      );
    });
  });

  describe('set_aside and bring_back on change_goal_step', () => {
    it('sets a step aside to the day a choice means, moving a sooner due date with it', async () => {
      const data = tables();
      row(data, 'goals.items', STEP).due_on = '2026-10-15';
      const aside = await made('change_goal_step', data, { change: 'set_aside', step_ref: STEP, until: 'next_week' });
      expect(row(data, 'goals.items', STEP)).toMatchObject({ starts_on: '2026-10-19', due_on: '2026-10-19' });
      expect(aside.summary).toBe('Dash set the step "Buy shoes" aside until 2026-10-19, and moved its due date to that day with it.');
      expect(aside.before).toMatchObject({ starts_on: null, due_on: '2026-10-15' });
      expect(aside.undo).toBeNull();
    });

    it('refuses a day that is not after today, and a step of someone else', async () => {
      expect(await refused('change_goal_step', tables(), { change: 'set_aside', step_ref: STEP, until: TODAY })).toBe(
        'until must be one of tomorrow, weekend, next_week, next_month, or a day after today as YYYY-MM-DD.',
      );
      expect(await refused('change_goal_step', tables(), { change: 'set_aside', step_ref: THEIR_STEP, until: 'tomorrow' })).toBe(
        'There is no step of theirs with that step_ref. Look it up first.',
      );
    });

    it('brings a set-aside step back by clearing its start date, and refuses one that is not set aside', async () => {
      const data = tables();
      row(data, 'goals.items', STEP).starts_on = '2026-11-01';
      const back = await made('change_goal_step', data, { change: 'bring_back', step_ref: STEP });
      expect(row(data, 'goals.items', STEP).starts_on).toBeNull();
      expect(back.summary).toBe('Dash brought the step "Buy shoes" back now, clearing its start date of 2026-11-01.');
      expect(await refused('change_goal_step', data, { change: 'bring_back', step_ref: STEP })).toBe(
        'That step is not set aside: it has no start date still to come.',
      );
    });
  });

  describe('change_goals_inbox', () => {
    const EVENT = '99999999-9999-4999-8999-999999999999';
    const LATER = '99999999-9999-4999-8999-99999999999a';
    const THEIRS = '99999999-9999-4999-8999-99999999999b';
    const suggestion = (id: string, title: string, fields: Record<string, unknown> = {}) => ({
      id,
      user_id: ME,
      item_id: null,
      title,
      reaction: 'going',
      attended: null,
      happens_on: '2026-10-10',
      ...fields,
    });
    function inboxTables(): FakeTables {
      const data = tables();
      row(data, 'goals.items', STEP).updated_at = '2026-10-13T09:00:00Z';
      return {
        ...data,
        'core.inbox_snoozes': [],
        'core.thread_turns': [],
        'goals.suggestions': [
          suggestion(EVENT, 'Jazz night at the Blue Note'),
          suggestion(LATER, 'Pottery open studio', { happens_on: '2026-10-20' }),
          suggestion(THEIRS, 'Jazz brunch', { user_id: THEM }),
        ],
      };
    }

    it('snoozes a step until the start of the day in their zone, and brings it back', async () => {
      // The expected days are written for 14 October; pin the clock so the test passes on any day.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
      onTestFinished(() => {
      vi.useRealTimers();
    });
      const data = inboxTables();
      const snoozed = await made('change_goals_inbox', data, { change: 'snooze', row_ref: STEP, until: 'tomorrow' });
      const kept = data['core.inbox_snoozes']![0];
      expect(kept).toMatchObject({ user_id: ME, ref: `goals.items:${STEP}`, row_updated_at: '2026-10-13T09:00:00Z' });
      expect(new Date(String(kept.snoozed_until)).toISOString()).toBe('2026-10-15T00:00:00.000Z');
      expect(snoozed).toMatchObject({ kind: 'change_goals_inbox', op: 'insert', subjectRef: `core.inbox_snoozes:${kept.id}` });
      expect(snoozed.summary).toBe('Dash snoozed "Buy shoes" on the Goals Inbox until 2026-10-15.');

      const back = await made('change_goals_inbox', data, { change: 'unsnooze', row_ref: STEP });
      expect(data['core.inbox_snoozes']).toEqual([]);
      expect(back).toMatchObject({ op: 'delete', subjectRef: `core.inbox_snoozes:${kept.id}` });
      expect(await refused('change_goals_inbox', data, { change: 'unsnooze', row_ref: STEP })).toBe(
        'That row is not snoozed, so it is in the Inbox already.',
      );
    });

    it('refuses to snooze a row of someone else or to a day gone by', async () => {
      expect(await refused('change_goals_inbox', inboxTables(), { change: 'snooze', row_ref: THEIR_STEP, until: 'tomorrow' })).toBe(
        'There is no goal or step of theirs with that row_ref. Look it up first.',
      );
      expect(await refused('change_goals_inbox', inboxTables(), { change: 'snooze', row_ref: STEP, until: '2026-10-01' })).toBe(
        'until must be tomorrow, weekend, next_week, next_month, or a day after today as YYYY-MM-DD.',
      );
    });

    it('records that they went to an event named in words, written as the person', async () => {
      const data = inboxTables();
      const histories: unknown[] = [];
      const went = await made('change_goals_inbox', data, { change: 'went', event: 'blue note' }, histories);
      expect(row(data, 'goals.suggestions', EVENT).attended).toBe(true);
      expect(row(data, 'goals.suggestions', THEIRS).attended).toBeNull();
      expect(went).toMatchObject({ op: 'update', subjectRef: `goals.suggestions:${EVENT}`, undo: null });
      expect(went.before).toMatchObject({ attended: null });
      expect(went.summary).toBe('Dash recorded that they went to "Jazz night at the Blue Note".');
      expect(histories).toEqual([{}]);
    });

    it('refuses an event still to come, and lists the choices for one that does not match', async () => {
      expect(await refused('change_goals_inbox', inboxTables(), { change: 'did_not_go', event: 'pottery' })).toBe(
        '"Pottery open studio" is on 2026-10-20, which is still to come.',
      );
      expect(await refused('change_goals_inbox', inboxTables(), { change: 'went', event: 'opera' })).toBe(
        'No event they are going to matches "opera". The events waiting for an answer: "Jazz night at the Blue Note", "Pottery open studio".',
      );
    });
  });
});
