import { describe, expect, it, vi } from 'vitest';
import type { ChangeOutcome } from '@/lib/ask/changes';
import type { DashAction } from '@/lib/core/dash-actions';
import type { CaptureGoal, CaptureStep, FiledEntry } from '@/lib/goals/capture';
import { applyCaptureAction, saveFiled, undoFiled, undoFiledAction } from '@/lib/goals/capture-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { undoDashTodayWith } from '@/lib/shell/dash-today';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from './stubs/fake-schema-db';

/**
 * What capture files is recorded as Dash's (plan #1569): each line leaves a
 * core.dash_actions row with surface capture, the line keeps the record's id,
 * and undoing the line, from the capture panel or from Home, puts the filing
 * back and marks the record undone.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GOAL = id(1);
const STEP = id(2);
const CAPTURE = id(3);
const TODAY = '2026-10-03';

const goal: CaptureGoal = {
  ref: 'g1',
  id: GOAL,
  title: 'Run a half marathon',
  areaName: 'Health',
  unit: null,
  target: null,
};
const step: CaptureStep = {
  ref: 's1',
  id: STEP,
  goalRef: 'g1',
  goalTitle: 'Run a half marathon',
  title: 'Buy running shoes',
  kind: 'mine',
  depth: 0,
  rhythm: null,
};

function setup() {
  const tables: FakeTables = {
    'goals.items': [
      { id: GOAL, user_id: ME, level: 'goal', parent_id: null, title: goal.title, status: 'open', archived_at: null, position: 0 },
      { id: STEP, user_id: ME, level: 'step', parent_id: GOAL, title: step.title, status: 'open', archived_at: null, position: 0 },
    ],
    'goals.captures': [{ id: CAPTURE, user_id: ME, body: 'bought the shoes', filed: [] }],
    'core.dash_actions': [],
  };
  const dash = fakeDashDeps(tables, ME);
  const client = fakeSchemaDb(tables)('goals') as unknown as GoalsSupabaseClient;
  return { tables, dash, client };
}

async function file(
  { client, dash }: ReturnType<typeof setup>,
  action: Parameters<typeof applyCaptureAction>[2],
): Promise<FiledEntry> {
  const entry = await applyCaptureAction(client, { userId: ME, today: TODAY, captureId: CAPTURE, dash }, action);
  expect(entry).not.toBeNull();
  await saveFiled(client, CAPTURE, [entry!]);
  return entry!;
}

describe('filing from capture', () => {
  it('records a closed step as Dash’s, with the row before and after', async () => {
    const world = setup();
    const entry = await file(world, { kind: 'close', step });

    const [record] = world.tables['core.dash_actions'];
    expect(record).toMatchObject({
      surface: 'capture',
      kind: 'close_step',
      status: 'done',
      subject_ref: `goals.items:${STEP}`,
      op: 'update',
      undo: { capture_id: CAPTURE },
      summary: 'From your capture, Dash closed "Buy running shoes" in Run a half marathon.',
    });
    expect(record.before_values).toMatchObject({ status: 'open' });
    expect(record.after_values).toMatchObject({ status: 'done' });
    expect(entry.action_id).toBe(record.id);
  });

  it('records an added step as an insert', async () => {
    const world = setup();
    const entry = await file(world, {
      kind: 'add',
      goal,
      parent: null,
      title: 'Book the race',
      stepKind: 'mine',
    });
    const [record] = world.tables['core.dash_actions'];
    if (entry.kind !== 'add') throw new Error('expected an add');
    expect(record).toMatchObject({
      surface: 'capture',
      kind: 'add_step',
      subject_ref: `goals.items:${entry.step_id}`,
      op: 'insert',
      before_values: null,
    });
    expect(entry.action_id).toBe(record.id);
  });

  it('still files the line when nothing is recorded', async () => {
    const { client } = setup();
    const entry = await applyCaptureAction(client, { userId: ME, today: TODAY, captureId: CAPTURE }, { kind: 'close', step });
    expect(entry).toMatchObject({ kind: 'close' });
    expect(entry?.action_id).toBeUndefined();
  });
});

describe('undoing a filed line', () => {
  it('from the capture panel puts the step back and marks the record undone', async () => {
    const world = setup();
    await file(world, { kind: 'close', step });

    const out = await undoFiled(world.client, CAPTURE, 0, world.dash);
    expect(out.ok).toBe(true);
    expect(world.tables['goals.items'][1]).toMatchObject({ status: 'open' });
    expect(world.tables['core.dash_actions'][0]).toMatchObject({ status: 'undone' });
  });

  it('from its record finds the line and does the same', async () => {
    const world = setup();
    const entry = await file(world, { kind: 'add', goal, parent: null, title: 'Book the race', stepKind: 'mine' });

    const out = await undoFiledAction(world.client, CAPTURE, entry.action_id!, world.dash);
    expect(out.ok).toBe(true);
    const added = world.tables['goals.items'].find((row) => row.title === 'Book the race');
    // Archived, as capture's Undo has always done, not deleted.
    expect(added?.archived_at).toEqual(expect.any(String));
    expect(world.tables['core.dash_actions'][0]).toMatchObject({ status: 'undone' });
    const filed = world.tables['goals.captures'][0].filed as FiledEntry[];
    expect(filed[0].undone_at).toEqual(expect.any(String));
  });

  it('from Home hands a capture record to capture’s undo', async () => {
    const world = setup();
    await file(world, { kind: 'close', step });
    const [record] = world.tables['core.dash_actions'];
    const askUndo = vi.fn<(id: string) => Promise<ChangeOutcome>>();
    const undoCapture = vi.fn(async (action: DashAction) => {
      const result = await undoFiledAction(world.client, action.undo!.capture_id as string, action.id, world.dash);
      return result.ok ? { ok: true as const, paths: [] } : { ok: false as const, error: result.error };
    });

    const out = await undoDashTodayWith(world.dash, record.id as string, askUndo, undefined, undoCapture);
    expect(out).toEqual({ ok: true, paths: [] });
    expect(undoCapture).toHaveBeenCalledOnce();
    expect(askUndo).not.toHaveBeenCalled();
    expect(world.tables['goals.items'][1]).toMatchObject({ status: 'open' });
    expect(world.tables['core.dash_actions'][0]).toMatchObject({ status: 'undone' });

    // A second press finds it undone already.
    const again = await undoDashTodayWith(world.dash, record.id as string, askUndo, undefined, undoCapture);
    expect(again.ok).toBe(false);
    expect(undoCapture).toHaveBeenCalledOnce();
  });
});
