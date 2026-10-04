import { describe, expect, it, vi } from 'vitest';
import { fileCaptureParts, type CaptureWriters } from '@/lib/capture/file';
import type { CapturePart } from '@/lib/capture/sort';
import { recordDashAction, undoDashAction } from '@/lib/core/dash-actions';
import { writeRoleNote } from '@/lib/dash/writes';
import type { FiledEntry } from '@/lib/goals/capture';
import { undoDashTodayWith } from '@/lib/shell/dash-today';
import { fakeDashDeps, fakeId, type FakeTables } from './stubs/fake-schema-db';

/**
 * The one capture box (plan #1581): a todo, a goal update and a job note
 * typed into it each land through their workspace's own writer, the box
 * names where each went, and a todo or a note is recorded as capture's in
 * core.dash_actions so Undo, from the box or from Home, takes it back.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const ROLE = { id: '00000000-0000-4000-8000-000000000002', title: 'Product Analyst', company: 'Stripe' };
const CAPTURE = '00000000-0000-4000-8000-000000000003';

const GOAL_LINE: FiledEntry = {
  kind: 'close',
  step_id: '00000000-0000-4000-8000-000000000004',
  title: 'Run 10k',
  goal_title: 'Run a half marathon',
  undone_at: null,
};

function setup() {
  const tables: FakeTables = {
    'todo.tasks': [],
    'job_search.roles': [{ id: ROLE.id, user_id: ME, title: ROLE.title }],
    'core.dash_actions': [],
  };
  const dash = fakeDashDeps(tables, ME);
  const goals = vi.fn(async () => ({ captureId: CAPTURE, filed: [GOAL_LINE] }));
  const writers: CaptureWriters = {
    todo: async (text) => {
      const id = fakeId();
      tables['todo.tasks'].push({ id, user_id: ME, title: text, status: 'open' });
      return { id };
    },
    goals,
    jobs: async (roleId, text) => {
      const written = await writeRoleNote({ userId: ME, enabledModules: ['jobs'], db: dash.db }, roleId, text);
      return written.ok ? { ok: true, subjectRef: written.subjectRef } : { ok: false, error: written.error };
    },
    record: (entry) => recordDashAction(dash, entry),
  };
  return { tables, dash, writers, goals };
}

const parts: CapturePart[] = [
  { place: 'todo', text: 'call the dentist', goal: null, role: null },
  { place: 'goals', text: 'ran 10k this morning', goal: { id: fakeId(), title: 'Run a half marathon' }, role: null },
  { place: 'jobs', text: 'Recruiter is Sam', goal: null, role: ROLE },
];

describe('filing from the one capture box', () => {
  it('lands each part in its workspace and names where it went', async () => {
    const world = setup();
    const { filed, errors } = await fileCaptureParts(parts, world.writers);

    expect(errors).toEqual([]);
    expect(filed.map((item) => item.where)).toEqual([
      'Todo · Today',
      'Goals · Run a half marathon',
      'Job search · Product Analyst at Stripe',
    ]);
    expect(world.tables['todo.tasks']).toMatchObject([{ title: 'call the dentist' }]);
    expect(world.goals).toHaveBeenCalledWith('ran 10k this morning');
    expect(filed[1].goals).toEqual({ captureId: CAPTURE, entries: [GOAL_LINE] });
    expect(world.tables['core.conversation_turns']).toMatchObject([
      { ref: `job_search.roles:${ROLE.id}`, author: 'me', body: 'Recruiter is Sam' },
    ]);
  });

  it('records the todo and the note as capture’s, and leaves the goal lines to Goals', async () => {
    const world = setup();
    const { filed } = await fileCaptureParts(parts, world.writers);

    expect(world.tables['core.dash_actions']).toMatchObject([
      { surface: 'capture', kind: 'add_todo', op: 'insert', status: 'done' },
      { surface: 'capture', kind: 'add_role_note', op: 'insert', status: 'done' },
    ]);
    expect(filed[0].actionId).toBe(world.tables['core.dash_actions'][0].id);
    expect(filed[1].actionId).toBeNull();
    expect(filed[2].actionId).toBe(world.tables['core.dash_actions'][1].id);
  });

  it('undoes a todo and a note from the box by the generic rule', async () => {
    const world = setup();
    const { filed } = await fileCaptureParts(parts, world.writers);

    const todo = await undoDashAction(world.dash, filed[0].actionId!);
    const note = await undoDashAction(world.dash, filed[2].actionId!);
    expect(todo.ok).toBe(true);
    expect(note.ok).toBe(true);
    expect(world.tables['todo.tasks']).toEqual([]);
    expect(world.tables['core.conversation_turns']).toEqual([]);
    expect(world.tables['core.dash_actions'].map((row) => row.status)).toEqual(['undone', 'undone']);
  });

  it('undoes a todo from Home without handing it to Goals’ capture undo', async () => {
    const world = setup();
    const { filed } = await fileCaptureParts(parts.slice(0, 1), world.writers);
    const undoCapture = vi.fn();

    const out = await undoDashTodayWith(world.dash, filed[0].actionId!, vi.fn(), undefined, undoCapture);
    expect(out.ok).toBe(true);
    expect(undoCapture).not.toHaveBeenCalled();
    expect(world.tables['todo.tasks']).toEqual([]);
  });

  it('says why a job note with no role was not filed, and files the rest', async () => {
    const world = setup();
    const { filed, errors } = await fileCaptureParts(
      [parts[0], { place: 'jobs', text: 'they called', goal: null, role: null }],
      world.writers,
    );
    expect(filed.map((item) => item.place)).toEqual(['todo']);
    expect(errors).toEqual(['Dash could not tell which job this is about. Name the company and try again.']);
  });

  it('refuses a role that is not theirs, writing nothing', async () => {
    const world = setup();
    const { filed, errors } = await fileCaptureParts(
      [{ place: 'jobs', text: 'note', goal: null, role: { ...ROLE, id: fakeId() } }],
      world.writers,
    );
    expect(filed).toEqual([]);
    expect(errors[0]).toMatch(/not one of theirs/);
    expect(world.tables['core.dash_actions']).toEqual([]);
  });
});
