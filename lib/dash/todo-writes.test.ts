import { describe, expect, it } from 'vitest';
import { TODO_CHANGE_KINDS } from '@/lib/ask/todo-changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { runTodoWrite, TODO_WRITES, type TodoWriteEnv } from './todo-writes';

/**
 * The Todo writes an agent makes (plan #1894.9.1): each one row, scoped to the
 * person by its own filter (the connector runs them with no row level
 * security), and reported with the values its Undo needs.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const TASK = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const ROLE = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';

function env(tables: FakeTables): TodoWriteEnv {
  return { userId: ME, todo: fakeSchemaDb(tables)('todo'), timezone: 'Europe/London' };
}

const write = (name: string) => TODO_WRITES.find((entry) => entry.name === name)!;

async function made(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const result = await runTodoWrite(write(name), env(tables), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

const task = (fields: Record<string, unknown> = {}) => ({
  id: TASK,
  user_id: ME,
  title: 'Book the dentist',
  body: null,
  status: 'open',
  pinned: false,
  snoozed_until: null,
  parent_id: null,
  ...fields,
});

describe('the Todo writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(TODO_WRITES.map((entry) => entry.name)).toEqual([...TODO_CHANGE_KINDS]);
  });

  it('writes notes and pins a todo, keeping the row as it was', async () => {
    const tables = { 'todo.tasks': [task()] };
    const change = await made('edit_todo', tables, { todo_ref: TASK, notes: 'Ask about the crown.', pinned: true });
    expect(change.op).toBe('update');
    expect(change.subjectRef).toBe(`todo.tasks:${TASK}`);
    expect(change.before).toMatchObject({ body: null, pinned: false });
    expect(change.after).toMatchObject({ body: 'Ask about the crown.', pinned: true });
    expect(change.summary).toBe('Dash changed the todo "Book the dentist": its notes written and pinned.');
  });

  it('puts a todo off for a week, drops one and reopens one', async () => {
    const tables = { 'todo.tasks': [task()] };
    const later = await made('edit_todo', tables, { todo_ref: TASK, later: true });
    expect(typeof later.after.snoozed_until).toBe('string');
    expect(later.summary).toBe('Dash changed the todo "Book the dentist": put off for 7 days.');
    const dropped = await made('edit_todo', tables, { todo_ref: TASK, state: 'dropped' });
    expect(dropped.after).toMatchObject({ status: 'dropped' });
    const reopened = await made('edit_todo', tables, { todo_ref: TASK, state: 'open', later: false });
    expect(reopened.after).toMatchObject({ status: 'open', snoozed_until: null });
  });

  it("refuses a todo that is not the person's, and a call that changes nothing", async () => {
    const tables = { 'todo.tasks': [task({ user_id: 'someone else' })] };
    expect(await runTodoWrite(write('edit_todo'), env(tables), { todo_ref: TASK, pinned: true })).toEqual({
      ok: false,
      error: 'There is no todo of theirs with that ref. Look it up first.',
    });
    tables['todo.tasks'][0].user_id = ME;
    expect(await runTodoWrite(write('edit_todo'), env(tables), { todo_ref: TASK })).toEqual({
      ok: false,
      error: 'Say what to change: notes, pinned, later or state.',
    });
    expect(await runTodoWrite(write('edit_todo'), env(tables), { todo_ref: TASK, state: 'open' })).toEqual({
      ok: false,
      error: 'That todo is open already.',
    });
  });

  it('adds an item to a list, and refuses a list on an item', async () => {
    const tables = { 'todo.tasks': [task({ title: 'Shopping' }), task({ id: ITEM, title: 'Milk', parent_id: TASK })] };
    const change = await made('add_todo_item', tables, { todo_ref: TASK, title: 'Eggs' });
    expect(change.op).toBe('insert');
    expect(change.after).toMatchObject({ user_id: ME, title: 'Eggs', parent_id: TASK });
    expect(change.summary).toBe('Dash added "Eggs" to the list on the todo "Shopping".');
    expect(await runTodoWrite(write('add_todo_item'), env(tables), { todo_ref: ITEM, title: 'Bread' })).toEqual({
      ok: false,
      error: 'That is an item on a list already. Add the item to the todo it sits under.',
    });
  });

  it('points a todo at a role, then moves the link rather than adding a second', async () => {
    const tables: FakeTables = { 'todo.tasks': [task()], 'todo.task_links': [] };
    const first = await made('link_todo', tables, { todo_ref: TASK, about: 'role', about_ref: ROLE });
    expect(first.op).toBe('insert');
    expect(first.after).toMatchObject({ task_id: TASK, relation: 'about', role_id: ROLE, note_id: null });
    expect(first.summary).toBe('Dash said the todo "Book the dentist" is about a role.');

    const second = await made('link_todo', tables, { todo_ref: TASK, about: 'note', about_ref: ROLE });
    expect(second.op).toBe('update');
    expect(second.subjectRef).toBe(first.subjectRef);
    expect(second.before).toMatchObject({ role_id: ROLE });
    expect(second.after).toMatchObject({ role_id: null, note_id: ROLE });
    expect(tables['todo.task_links']).toHaveLength(1);
  });

  it('adds an all-day event and a timed one in the person\'s zone', async () => {
    const tables: FakeTables = { 'todo.events': [] };
    const day = await made('add_event', tables, { title: 'Holiday', start_day: '2026-10-20', end_day: '2026-10-24', all_day: true });
    expect(day.after).toMatchObject({ user_id: ME, starts_on: '2026-10-20', ends_on: '2026-10-24', starts_at: null });
    expect(day.summary).toBe('Dash added "Holiday" to the calendar on 2026-10-20.');

    const timed = await made('add_event', tables, { title: 'Lunch with Sam', start_day: '2026-10-16', start_time: '13:00', end_time: '14:00', location: 'Dishoom' });
    // 13:00 in London in October is 12:00 UTC.
    expect(timed.after).toMatchObject({ starts_on: null, starts_at: '2026-10-16T12:00:00.000Z', location: 'Dishoom' });

    expect(await runTodoWrite(write('add_event'), env(tables), { title: 'Call', start_day: '2026-10-16', start_time: '13:00' })).toEqual({
      ok: false,
      error: 'Give it a start and an end time, or mark it all day.',
    });
  });

  it('moves an event and clears its place', async () => {
    const tables: FakeTables = {
      'todo.events': [{ id: EVENT, user_id: ME, title: 'Holiday', location: 'Rome', body: null, starts_on: '2026-10-20', ends_on: '2026-10-20', starts_at: null, ends_at: null }],
    };
    const change = await made('change_event', tables, { event_ref: EVENT, start_day: '2026-10-21', all_day: true, location: '' });
    expect(change.before).toMatchObject({ starts_on: '2026-10-20', location: 'Rome' });
    expect(change.after).toMatchObject({ starts_on: '2026-10-21', ends_on: '2026-10-21', location: null });
    expect(change.summary).toBe('Dash changed the event "Holiday": moved to 2026-10-21 and its place cleared.');
    expect(await runTodoWrite(write('change_event'), env(tables), { event_ref: EVENT, end_time: '10:00' })).toEqual({
      ok: false,
      error: 'To move it, give start_day, and the times or all_day.',
    });
  });
});
