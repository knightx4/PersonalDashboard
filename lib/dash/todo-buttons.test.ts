import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '@/lib/todo/agenda/sources';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { DashWriteContext, DashWriteResult } from './registry';

/**
 * Each Todo tool writes the rows its button writes (plan #2473.3). The
 * button's own server action runs on one copy of the person's rows, the tool
 * on another, from the same input, and the two copies are compared. The
 * session, the account's zone and the clients the pages make are stubbed to
 * the same in-memory database.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const ME = '00000000-0000-4000-8000-0000000000aa';
const ZONE = 'Europe/London';

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, shown: [] as unknown[] }));

vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));
vi.mock('@/lib/core/account/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/account/settings')>()),
  loadAccountSettings: async () => ({ timezone: 'Europe/London', enabledModules: ['todo', 'jobs'] }),
}));
vi.mock('@/lib/todo/agenda/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/todo/agenda/settings')>()),
  loadAgendaSettings: async () => ({ horizonDays: 14 }),
}));
vi.mock('@/lib/todo/auth/server', async () => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return { createTodoClient: async () => fake(state.tables)('todo') };
});
vi.mock('@/lib/jobs/auth/server', async (importOriginal) => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return { ...(await importOriginal<typeof import('@/lib/jobs/auth/server')>()), createClient: async () => fake(state.tables)('job_search') };
});
vi.mock('@/lib/ask/agenda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ask/agenda')>()),
  loadAgendaItems: async () => state.shown,
}));

const actions = await import('@/app/todo/actions');
const calendar = await import('@/app/todo/calendar/actions');
const agenda = await import('@/app/todo/source-actions');
const { runTodoWrite, TODO_WRITES } = await import('./todo-writes');
const { WRITE_TOOLS } = await import('./writes');

const TASK = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const DONE_ITEM = '22222222-2222-4222-8222-222222222223';
const ROLE = '33333333-3333-4333-8333-333333333333';
const NOTE = '33333333-3333-4333-8333-333333333334';
const EVENT = '44444444-4444-4444-8444-444444444444';
const REMINDER = '55555555-5555-4555-8555-555555555555';

const task = (fields: Record<string, unknown> = {}) => ({
  id: TASK,
  user_id: ME,
  title: 'Book the dentist',
  body: null,
  status: 'open',
  pinned: false,
  due_on: null,
  due_at: null,
  snoozed_until: null,
  parent_id: null,
  ...fields,
});

/** Two copies of the same rows: the button's and the tool's. */
function twins(seed: FakeTables): [FakeTables, FakeTables] {
  return [structuredClone(seed), structuredClone(seed)];
}

/** Runs a server action on its copy, as the page would. */
async function press<T>(tables: FakeTables, act: () => Promise<T>): Promise<T> {
  state.tables = tables;
  return act();
}

/** The rows as the database holds them, less what each insert makes up for itself. */
function rows(tables: FakeTables, key: string): Record<string, unknown>[] {
  return (tables[key] ?? []).map((row) => {
    const rest = { ...row };
    delete rest.id;
    delete rest.created_at;
    return rest;
  });
}

async function todoTool(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const write = TODO_WRITES.find((entry) => entry.name === name)!;
  const db = fakeSchemaDb(tables);
  const result = await runTodoWrite(write, { userId: ME, todo: db('todo'), timezone: ZONE, db: async (schema) => db(schema) }, input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function dashTool(name: string, tables: FakeTables, input: Record<string, unknown>): Promise<DashWriteResult> {
  const db = fakeSchemaDb(tables);
  const ctx: DashWriteContext = {
    userId: ME,
    today: '2026-10-03',
    timezone: ZONE,
    enabledModules: ['todo'],
    db: async (schema) => db(schema),
    searchSources: [],
    seen: () => true,
    goals: async () => db('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
  const result = await WRITE_TOOLS.find((tool) => tool.name === name)!.apply(ctx, input);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('add_todo, change_todo and close_todo write what their buttons write', () => {
  it('adds the same todo as the add bar', async () => {
    const [page, dash] = twins({ 'todo.tasks': [], 'todo.task_tags': [] });
    expect(await press(page, () => actions.addTask({}, form({ title: 'Call the bank', dueOn: '2099-01-15' })))).toMatchObject({ message: 'Added.' });
    await dashTool('add_todo', dash, { title: 'Call the bank', due_on: '2099-01-15' });
    expect(rows(dash, 'todo.tasks')).toEqual(rows(page, 'todo.tasks'));
  });

  it('renames and moves a todo as the row does', async () => {
    const [page, dash] = twins({ 'todo.tasks': [task({ due_on: '2099-01-15' })] });
    await press(page, async () => {
      await actions.renameTaskAction(TASK, 'Book the dentist for a checkup');
      await actions.rescheduleTaskAction(TASK, '2099-01-16', '09:30');
    });
    await dashTool('change_todo', dash, { todo_ref: TASK, title: 'Book the dentist for a checkup', due_on: '2099-01-16', due_time: '9:30' });
    expect(dash['todo.tasks']).toEqual(page['todo.tasks']);
    expect(dash['todo.tasks'][0]).toMatchObject({ due_on: null, due_at: '2099-01-16T09:30:00.000Z' });
  });

  it('ticks off a todo and the open items on its list, as the checkbox does', async () => {
    const seed = {
      'todo.tasks': [task(), task({ id: ITEM, title: 'Find the number', parent_id: TASK }), task({ id: DONE_ITEM, title: 'Old', parent_id: TASK, status: 'done' })],
    };
    const [page, dash] = twins(seed);
    expect(await press(page, () => actions.completeTask(TASK))).toEqual({ error: null, items: [ITEM] });
    const closed = await dashTool('close_todo', dash, { todo_ref: TASK });
    expect(dash['todo.tasks']).toEqual(page['todo.tasks']);
    expect(closed.ok && closed.undo).toEqual({ items: [ITEM] });
  });
});

describe('edit_todo writes what its buttons write', () => {
  // Tagged already, so Dash's own rule (tag an untagged todo by its date) does not add one.
  const seed = (fields: Record<string, unknown> = {}): FakeTables => ({
    'todo.tasks': [task(fields)],
    'todo.task_tags': [{ task_id: TASK, tag: 'home' }],
  });

  it.each([
    ['pins it', {}, () => actions.pinTask(TASK, true), { pinned: true }],
    ['drops it', {}, () => actions.dropTask(TASK), { state: 'dropped' }],
    ['reopens it', { status: 'done' }, () => actions.reopenTask(TASK), { state: 'open' }],
    ['puts it off', {}, () => actions.laterTask(TASK, '2099-01-15'), { later: '2099-01-15' }],
    ['brings it back', { snoozed_until: '2099-01-15T00:00:00.000Z' }, () => actions.bringBackTask(TASK), { later: 'back' }],
  ] as const)('%s', async (_name, fields, act, input) => {
    const [page, dash] = twins(seed(fields));
    expect(await press(page, act)).toEqual({ error: null });
    await todoTool('edit_todo', dash, { todo_ref: TASK, ...input });
    expect(dash['todo.tasks']).toEqual(page['todo.tasks']);
    expect(dash['todo.task_tags']).toEqual(page['todo.task_tags']);
  });

  it('writes notes and the pin as the form does', async () => {
    const [page, dash] = twins(seed());
    const saved = await press(page, () =>
      actions.editTask({}, form({ id: TASK, title: 'Book the dentist', body: 'Ask about the crown.', dueOn: '', dueTime: '', pinned: 'on' })),
    );
    expect(saved).toEqual({ message: 'Saved.' });
    await todoTool('edit_todo', dash, { todo_ref: TASK, notes: 'Ask about the crown.', pinned: true });
    expect(dash['todo.tasks']).toEqual(page['todo.tasks']);
  });

  it('tags it as the tag picker does, with the tag its date gives as well', async () => {
    const [page, dash] = twins({ 'todo.tasks': [task()], 'todo.task_tags': [] });
    expect(await press(page, () => actions.tagTask(TASK, 'Work'))).toEqual({ error: null });
    await todoTool('edit_todo', dash, { todo_ref: TASK, tags: ['work'] });
    expect(dash['todo.tasks']).toEqual(page['todo.tasks']);
    expect(rows(page, 'todo.task_tags')).toEqual([{ task_id: TASK, tag: 'work' }]);
    expect(rows(dash, 'todo.task_tags')).toEqual(expect.arrayContaining(rows(page, 'todo.task_tags')));
  });
});

describe('add_todo_item and link_todo write what their buttons write', () => {
  it('adds an item as the box under the list does', async () => {
    const [page, dash] = twins({ 'todo.tasks': [task()] });
    expect(await press(page, () => actions.addItem(TASK, 'Find the number'))).toEqual({ error: null });
    await todoTool('add_todo_item', dash, { todo_ref: TASK, title: 'Find the number' });
    expect(rows(dash, 'todo.tasks')).toEqual(rows(page, 'todo.tasks'));
  });

  it('points a todo at a role, and then at a note, as Point at does', async () => {
    const [page, dash] = twins({ 'todo.tasks': [task()], 'todo.task_links': [] });
    expect(await press(page, () => actions.pointTaskAt(TASK, 'role', ROLE))).toEqual({ error: null });
    await todoTool('link_todo', dash, { todo_ref: TASK, about: 'role', about_ref: ROLE });
    expect(rows(dash, 'todo.task_links')).toEqual(rows(page, 'todo.task_links'));

    expect(await press(page, () => actions.pointTaskAt(TASK, 'note', NOTE))).toEqual({ error: null });
    await todoTool('link_todo', dash, { todo_ref: TASK, about: 'note', about_ref: NOTE });
    expect(rows(dash, 'todo.task_links')).toEqual(rows(page, 'todo.task_links'));
    expect(dash['todo.task_links']).toHaveLength(1);
  });
});

describe('add_event and change_event write what the calendar form writes', () => {
  const lunch = { title: 'Lunch with Sam', body: 'Bring the book', location: 'Dishoom', allDay: '', startDay: '2099-01-16', endDay: '', startTime: '13:00', endTime: '14:00' };

  it('adds the same event', async () => {
    const [page, dash] = twins({ 'todo.events': [] });
    await press(page, () => calendar.addEvent({}, form(lunch)));
    await todoTool('add_event', dash, { title: 'Lunch with Sam', notes: 'Bring the book', location: 'Dishoom', start_day: '2099-01-16', start_time: '13:00', end_time: '14:00' });
    expect(rows(dash, 'todo.events')).toEqual(rows(page, 'todo.events'));
    expect(dash['todo.events'][0]).toMatchObject({ starts_at: '2099-01-16T13:00:00.000Z', location: 'Dishoom', body: 'Bring the book' });
  });

  it('changes an event the same way, all day this time and with its place cleared', async () => {
    const seed: FakeTables = {
      'todo.events': [{ id: EVENT, user_id: ME, title: 'Lunch', body: null, location: 'Dishoom', starts_on: null, ends_on: null, starts_at: '2099-01-16T13:00:00.000Z', ends_at: '2099-01-16T14:00:00.000Z' }],
    };
    const [page, dash] = twins(seed);
    await press(page, () =>
      calendar.editEvent({}, form({ id: EVENT, title: 'Lunch with Sam', body: '', location: '', allDay: 'on', startDay: '2099-01-17', endDay: '2099-01-18', startTime: '', endTime: '' })),
    );
    await todoTool('change_event', dash, { event_ref: EVENT, title: 'Lunch with Sam', location: '', start_day: '2099-01-17', end_day: '2099-01-18', all_day: true });
    expect(dash['todo.events']).toEqual(page['todo.events']);
  });
});

describe('change_agenda_row writes what the agenda row writes', () => {
  const RAISE = '66666666-6666-4666-8666-666666666666';
  const item = (fields: Partial<AgendaItem>): AgendaItem => ({
    key: 'x', source: 'raised', ref: 'x', title: 'Keep the old export?', day: null, at: null, link: null, action: null, detail: null, completable: false, ...fields,
  });

  beforeEach(() => {
    state.shown = [
      item({ key: `raised:${RAISE}`, source: 'raised', ref: `public.raised_items:${RAISE}` }),
      item({ key: `job_reminders:${REMINDER}`, source: 'job_reminders', ref: `job_search.reminders:${REMINDER}`, title: 'Follow up with Acme', completable: true }),
    ];
  });

  it('dismisses a row, then puts it off, as Drop and Later do', async () => {
    const [page, dash] = twins({ 'todo.dismissals': [] });
    expect(await press(page, () => agenda.dismissItem('raised', `raised:${RAISE}`))).toEqual({ error: null });
    await todoTool('change_agenda_row', dash, { agenda_source: 'raised', agenda_key: `raised:${RAISE}`, verb: 'dismiss' });
    expect(rows(dash, 'todo.dismissals')).toEqual(rows(page, 'todo.dismissals'));

    expect(await press(page, () => agenda.deferItem('raised', `raised:${RAISE}`, '2099-01-15'))).toEqual({ error: null });
    await todoTool('change_agenda_row', dash, { agenda_source: 'raised', agenda_key: `raised:${RAISE}`, verb: 'put_off', until: '2099-01-15' });
    expect(rows(dash, 'todo.dismissals')).toEqual(rows(page, 'todo.dismissals'));
  });

  it('finishes a job reminder on its own row, as Done does', async () => {
    const [page, dash] = twins({ 'job_search.reminders': [{ id: REMINDER, user_id: ME, body: 'x', due_at: '2026-10-01T09:00:00Z', completed_at: null }] });
    expect(await press(page, () => agenda.completeItem('job_reminders', `job_reminders:${REMINDER}`))).toEqual({ error: null });
    await todoTool('change_agenda_row', dash, { agenda_source: 'job_reminders', agenda_key: `job_reminders:${REMINDER}`, verb: 'finish' });
    expect(dash['job_search.reminders']).toEqual(page['job_search.reminders']);
    expect(page['job_search.reminders'][0].completed_at).toEqual(expect.any(String));
  });
});
