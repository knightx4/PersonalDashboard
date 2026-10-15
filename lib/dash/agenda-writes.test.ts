import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '@/lib/todo/agenda/sources';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';

/**
 * change_agenda_row (plan #1894.9.2): a row another workspace put on the Todo
 * agenda finished, put off or dismissed. The agenda itself is read through
 * loadAgendaItems, which is stubbed here to the rows the page would show.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const shown = vi.hoisted(() => ({ items: [] as AgendaItem[] }));

vi.mock('@/lib/ask/agenda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ask/agenda')>()),
  loadAgendaItems: async () => shown.items,
}));

const { runTodoWrite, TODO_WRITES } = await import('./todo-writes');
type Env = Parameters<typeof runTodoWrite>[1];

const ME = '00000000-0000-4000-8000-0000000000aa';
const REMINDER = '11111111-1111-4111-8111-111111111111';
const STEP = '22222222-2222-4222-8222-222222222222';
const RAISE = '33333333-3333-4333-8333-333333333333';

const write = TODO_WRITES.find((entry) => entry.name === 'change_agenda_row')!;

function env(tables: FakeTables): Env {
  return { userId: ME, todo: fakeSchemaDb(tables)('todo'), timezone: 'Europe/London', db: async (schema) => fakeSchemaDb(tables)(schema) };
}

function item(fields: Partial<AgendaItem>): AgendaItem {
  return {
    key: 'x',
    source: 'raised',
    ref: 'public.raised_items:x',
    title: 'Keep the old export?',
    day: null,
    at: null,
    link: null,
    action: null,
    detail: null,
    completable: false,
    ...fields,
  };
}

beforeEach(() => {
  shown.items = [
    item({ key: `job_reminders:${REMINDER}`, source: 'job_reminders', ref: `job_search.reminders:${REMINDER}`, title: 'Follow up with Acme', completable: true }),
    item({ key: `goal_steps:${STEP}`, source: 'goal_steps', ref: `goals.items:${STEP}`, title: 'Book the venue', completable: true }),
    item({ key: `raised:${RAISE}`, source: 'raised', ref: `public.raised_items:${RAISE}` }),
    item({ key: 'return_deadline:r1', source: 'return_deadlines', ref: 'public.orders:r1', title: 'Return the lamp' }),
    item({ key: 'goal_suggestions:s1', source: 'goal_steps', ref: 'goals.suggestions:s1', title: 'Gig on Friday', completable: true }),
  ];
});

async function made(tables: FakeTables, input: Record<string, unknown>) {
  const result = await runTodoWrite(write, env(tables), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

describe('change_agenda_row', () => {
  it('finishes a job reminder on its own row, keeping the row as it was', async () => {
    const tables: FakeTables = { 'job_search.reminders': [{ id: REMINDER, user_id: ME, body: 'x', completed_at: null }] };
    const change = await made(tables, { agenda_source: 'job_reminders', agenda_key: `job_reminders:${REMINDER}`, verb: 'finish' });
    expect(change.op).toBe('update');
    expect(change.subjectRef).toBe(`job_search.reminders:${REMINDER}`);
    expect(change.before).toMatchObject({ completed_at: null });
    expect(typeof change.after.completed_at).toBe('string');
    expect(change.summary).toBe('Dash finished "Follow up with Acme" on the Todo agenda.');
  });

  it('puts off a reminder by moving its own due date', async () => {
    const tables: FakeTables = { 'job_search.reminders': [{ id: REMINDER, user_id: ME, body: 'x', due_at: '2026-10-01T09:00:00Z', completed_at: null }] };
    const change = await made(tables, { agenda_source: 'job_reminders', agenda_key: `job_reminders:${REMINDER}`, verb: 'put_off', until: '2099-01-15' });
    expect(change.before).toMatchObject({ due_at: '2026-10-01T09:00:00Z' });
    expect(change.after.due_at).toBe(new Date('2099-01-15T00:00:00Z').toISOString());
  });

  it('closes a goal step on the step itself', async () => {
    const tables: FakeTables = { 'goals.items': [{ id: STEP, user_id: ME, level: 'step', status: 'open', archived_at: null }] };
    const change = await made(tables, { agenda_source: 'goal_steps', agenda_key: `goal_steps:${STEP}`, verb: 'finish' });
    expect(change.subjectRef).toBe(`goals.items:${STEP}`);
    expect(change.after).toMatchObject({ status: 'done' });
  });

  it('records a dismissal as the row it adds, and a second one as an update', async () => {
    const tables: FakeTables = { 'todo.dismissals': [] };
    const input = { agenda_source: 'raised', agenda_key: `raised:${RAISE}`, verb: 'dismiss' };
    const first = await made(tables, input);
    expect(first.op).toBe('insert');
    expect(first.before).toBeNull();
    expect(first.subjectRef.startsWith('todo.dismissals:')).toBe(true);
    expect(first.after).toMatchObject({ user_id: ME, source: 'raised_item', source_key: `raised:${RAISE}`, dismissed_until: null });
    expect(first.summary).toBe('Dash dismissed "Keep the old export?" on the Todo agenda.');

    const later = await made(tables, { ...input, verb: 'put_off', until: 'next_week' });
    expect(later.op).toBe('update');
    expect(later.subjectRef).toBe(first.subjectRef);
    expect(later.before).toMatchObject({ dismissed_until: null });
    expect(typeof later.after.dismissed_until).toBe('string');
  });

  it('refuses what the source cannot do, a row not on the agenda, and a row that is not theirs', async () => {
    const tables: FakeTables = { 'todo.dismissals': [], 'job_search.reminders': [{ id: REMINDER, user_id: 'someone else', completed_at: null }] };
    const refused = (input: Record<string, unknown>) => runTodoWrite(write, env(tables), input);
    expect(await refused({ agenda_source: 'return_deadlines', agenda_key: 'return_deadline:r1', verb: 'finish' })).toEqual({
      ok: false,
      error: 'Return deadlines: nothing here can finish that.',
    });
    expect(await refused({ agenda_source: 'raised', agenda_key: 'raised:other', verb: 'dismiss' })).toEqual({
      ok: false,
      error: 'That row is not on their agenda now. Look at the agenda again.',
    });
    expect(await refused({ agenda_source: 'job_reminders', agenda_key: `job_reminders:${REMINDER}`, verb: 'finish' })).toEqual({
      ok: false,
      error: 'That row is not theirs to change.',
    });
    expect(await refused({ agenda_source: 'goal_steps', agenda_key: 'goal_suggestions:s1', verb: 'finish' })).toEqual({
      ok: false,
      error: 'Whether they went to that is theirs to say. Put it off or dismiss it instead.',
    });
    expect(await refused({ agenda_source: 'raised', agenda_key: `raised:${RAISE}`, verb: 'delete' })).toEqual({
      ok: false,
      error: 'verb must be finish, put_off or dismiss.',
    });
  });
});
