import { beforeEach, describe, expect, it } from 'vitest';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type MadeDashChange } from '@/lib/talk/changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { DashWriteContext, DashWriteResult } from './registry';
import { WRITE_TOOLS } from './writes';

/**
 * log_hours (plan #2906.1): hours asked for in Ask go on the goal or step as
 * one progress entry for the day, the change is recorded, and Undo takes
 * that entry away and no other.
 */

const ME = '00000000-0000-4000-8000-0000000000cc';
const THEM = '00000000-0000-4000-8000-0000000000dd';
const AREA = '00000000-0000-4000-8000-000000000a01';
const GOAL = '00000000-0000-4000-8000-000000000a02';
const STEP = '00000000-0000-4000-8000-000000000a03';
const THEIR_GOAL = '00000000-0000-4000-8000-000000000a04';
const EARLIER = '00000000-0000-4000-8000-000000000e01';
const TODAY = '2026-11-04';

let tables: FakeTables;

function context(): DashWriteContext {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: TODAY,
    timezone: 'Europe/London',
    enabledModules: ['goals'],
    db: async (schema) => client(schema),
    searchSources: [],
    seen: () => true,
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
}

function apply(input: unknown): Promise<DashWriteResult> {
  return WRITE_TOOLS.find((t) => t.name === 'log_hours')!.apply(context(), input);
}

function ok(result: DashWriteResult): Extract<DashWriteResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

function error(result: DashWriteResult): string {
  if (result.ok) throw new Error(`expected a refusal, got ${result.summary}`);
  return result.error;
}

/** Keeps a write as Ask does, then undoes it through Ask's Undo. */
async function keepAndUndo(result: Extract<DashWriteResult, { ok: true }>) {
  const client = fakeSchemaDb(tables);
  const kept = await insertMadeChange(client('core') as unknown as CoreSupabaseClient, ME, 'conv-1', {
    ...result,
    undo: result.undo ?? null,
  } as unknown as MadeDashChange);
  const deps: ChangeDeps = {
    userId: ME,
    timezone: 'UTC',
    today: TODAY,
    enabledModules: ['goals'],
    core: client('core'),
    db: async (schema) => client(schema),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => `${TODAY}T12:00:00Z`,
  };
  return { kept, undone: await undoChange(deps, kept.id) };
}

const entries = () => tables['goals.progress_entries'];

beforeEach(() => {
  tables = {
    'core.dash_actions': [],
    'goals.items': [
      { id: GOAL, user_id: ME, level: 'goal', area_id: AREA, parent_id: null, title: 'Finish the thesis', status: 'open', archived_at: null, position: 1 },
      { id: STEP, user_id: ME, level: 'step', parent_id: GOAL, title: 'Write chapter two', status: 'open', archived_at: null, position: 1 },
      { id: THEIR_GOAL, user_id: THEM, level: 'goal', area_id: AREA, parent_id: null, title: 'Not mine', status: 'open', archived_at: null, position: 1 },
    ],
    'goals.progress_entries': [
      { id: EARLIER, user_id: ME, item_id: GOAL, happened_on: '2026-11-02', text: '1 hour', quantity: 1, unit: 'hours', undone_at: null },
    ],
  };
});

describe('log_hours', () => {
  it('logs hours on a goal for a day as one entry, and Undo takes away only that entry', async () => {
    const result = ok(await apply({ item_ref: GOAL, hours: 2, day: '2026-11-03', text: 'Read three papers' }));
    expect(entries()).toHaveLength(2);
    const entry = entries().find((row) => row.id !== EARLIER)!;
    expect(entry).toMatchObject({ user_id: ME, item_id: GOAL, happened_on: '2026-11-03', quantity: 2, unit: 'hours', text: 'Read three papers' });
    expect(result).toMatchObject({
      kind: 'log_hours',
      op: 'insert',
      subjectRef: `goals.progress_entries:${entry.id}`,
      input: { verb: 'Logged 2 hours on', what: 'Finish the thesis', rest: ', on Tue 3 Nov', href: `/goals/${GOAL}`, where: 'Open the goal' },
      row: { table: 'goals.items', ref: GOAL, href: `/goals/${GOAL}` },
    });
    expect(result.summary).toBe('Dash logged 2 hours on the goal "Finish the thesis" for 2026-11-03.');

    const { kept, undone } = await keepAndUndo(result);
    expect(kept).toMatchObject({ status: 'done', kind: 'log_hours' });
    expect(undone).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect(entries().map((row) => row.id)).toEqual([EARLIER]);
  });

  it('logs on a step under its goal, today when no day is named, in the words of the hours', async () => {
    const result = ok(await apply({ item_ref: STEP, hours: 1 }));
    const entry = entries().find((row) => row.id !== EARLIER)!;
    expect(entry).toMatchObject({ item_id: STEP, happened_on: TODAY, quantity: 1, unit: 'hours', text: '1 hour' });
    expect(result.input).toMatchObject({
      verb: 'Logged 1 hour on',
      what: 'Write chapter two',
      rest: ' under Finish the thesis, on Wed 4 Nov',
      href: `/goals/${GOAL}/s/${STEP}`,
    });
  });

  it('refuses a day after today, or one that is not a date, and writes nothing', async () => {
    expect(error(await apply({ item_ref: GOAL, hours: 2, day: '2026-11-05' }))).toContain('has not happened yet');
    expect(error(await apply({ item_ref: GOAL, hours: 2, day: '2026-02-30' }))).toContain('must be a date');
    expect(error(await apply({ item_ref: GOAL, hours: 0 }))).toContain('more than 0');
    expect(error(await apply({ item_ref: GOAL, hours: 25 }))).toContain('more than 24 hours');
    expect(entries()).toHaveLength(1);
  });

  it('refuses a goal that is not theirs or not there, and writes nothing', async () => {
    expect(error(await apply({ item_ref: THEIR_GOAL, hours: 2 }))).toContain('no goal or step of theirs');
    expect(error(await apply({ item_ref: '00000000-0000-4000-8000-000000000fff', hours: 2 }))).toContain('Look it up first');
    expect(error(await apply({ item_ref: 'thesis', hours: 2 }))).toContain('as a lookup returned it');
    expect(entries()).toHaveLength(1);
  });
});
