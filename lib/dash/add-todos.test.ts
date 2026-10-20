import { beforeEach, describe, expect, it } from 'vitest';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { changeHref, changeSentence } from '@/lib/ask/change-view';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type DashChange, type MadeDashChange } from '@/lib/talk/changes';
import { fakeId, fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { DashWriteContext, DashWriteResult } from './registry';
import { SET_CAP, type RowSet } from './sets';
import { WRITE_TOOLS } from './writes';

/**
 * add_todos (plan #2472.4): one todo for each row a lookup matched, named
 * from the row, about the row, as one change with one Undo that takes out
 * the todos still untouched. One in-memory database stands in for the
 * person's clients.
 */

const ME = '00000000-0000-4000-8000-0000000000cc';
const SOMEONE = '00000000-0000-4000-8000-0000000000dd';
const ACME = '00000000-0000-4000-8000-00000000c001';
const BETA = '00000000-0000-4000-8000-00000000c002';
const ROLE_A = '00000000-0000-4000-8000-00000000a001';
const ROLE_B = '00000000-0000-4000-8000-00000000a002';
const ROLE_C = '00000000-0000-4000-8000-00000000a003';
const APP_A = '00000000-0000-4000-8000-00000000b001';
const NOT_MINE = '00000000-0000-4000-8000-00000000a009';

let tables: FakeTables;
let sets: Map<string, RowSet>;

function role(id: string, title: string, company: string | null, user = ME) {
  return { id, user_id: user, title, company_id: company };
}

/** createTask as lib/todo/tasks/write.ts does it: the row, then its tags. */
const createTask: DashWriteContext['createTask'] = async (userId, input) => {
  const id = fakeId();
  tables['todo.tasks'].push({
    id,
    user_id: userId,
    title: input.title,
    body: input.body,
    status: 'open',
    due_on: input.dueOn,
    due_at: null,
    pinned: input.pinned,
    snoozed_until: null,
    parent_id: null,
  });
  for (const tag of input.tags ?? []) tables['todo.task_tags'].push({ task_id: id, tag });
  return { id, error: null };
};

function context(over: Partial<DashWriteContext> = {}): DashWriteContext {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: '2026-10-20',
    timezone: 'UTC',
    enabledModules: ['todo', 'jobs'],
    db: async (schema) => client(schema),
    searchSources: [],
    seen: Object.assign(() => false, { sets }),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask,
    ...over,
  };
}

function deps(): ChangeDeps {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    timezone: 'UTC',
    today: '2026-10-20',
    enabledModules: ['todo', 'jobs'],
    core: client('core'),
    db: async (schema) => client(schema),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask,
    now: () => '2026-10-20T12:00:00Z',
  };
}

function apply(input: unknown, ctx = context()): Promise<DashWriteResult> {
  const tool = WRITE_TOOLS.find((t) => t.name === 'add_todos');
  if (!tool) throw new Error('no add_todos tool');
  return tool.apply(ctx, input);
}

function ok(result: DashWriteResult): Extract<DashWriteResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

function refused(result: DashWriteResult): string {
  if (result.ok) throw new Error('it was made');
  return result.error;
}

async function keep(result: Extract<DashWriteResult, { ok: true }>): Promise<DashChange> {
  const core = fakeSchemaDb(tables)('core') as unknown as CoreSupabaseClient;
  return insertMadeChange(core, ME, 'conv-1', { ...result, undo: result.undo ?? null } as unknown as MadeDashChange);
}

function addSet(table: string, refs: string[], size = refs.length): string {
  const name = `set ${sets.size + 1}`;
  sets.set(name, { name, table, refs, size });
  return name;
}

const todos = () => tables['todo.tasks'];

beforeEach(() => {
  sets = new Map();
  tables = {
    'core.dash_actions': [],
    'todo.tasks': [],
    'todo.task_tags': [],
    'todo.task_links': [],
    'job_search.companies': [
      { id: ACME, user_id: ME, name: 'Acme' },
      { id: BETA, user_id: ME, name: 'Beta Labs' },
    ],
    'job_search.roles': [
      role(ROLE_A, 'Product Manager', ACME),
      role(ROLE_B, 'Staff PM', BETA),
      role(ROLE_C, 'Founding PM', null),
      role(NOT_MINE, 'Theirs', ACME, SOMEONE),
    ],
    'job_search.applications': [{ id: APP_A, user_id: ME, role_id: ROLE_B, next_action: 'Write the cover letter' }],
    'learn.readings': [],
  };
});

describe('add_todos', () => {
  it('adds one todo per row, named from the row, about the row, dated and tagged alike', async () => {
    const set = addSet('job_search.roles', [ROLE_A, ROLE_B, ROLE_C]);
    const result = ok(await apply({ set, title: 'Follow up with {company} about {title}', due_on: '2026-10-20', tags: ['jobs'] }));

    expect(todos().map((t) => t.title)).toEqual([
      'Follow up with Acme about Product Manager',
      'Follow up with Beta Labs about Staff PM',
      // No company: {company} falls back to the row's own name.
      'Follow up with Founding PM about Founding PM',
    ]);
    expect(todos().every((t) => t.due_on === '2026-10-20' && t.user_id === ME)).toBe(true);
    // Due today, so tagged now as add_todo would, with the tag sent.
    for (const t of todos()) {
      expect(tables['todo.task_tags'].filter((row) => row.task_id === t.id).map((row) => row.tag).sort()).toEqual(['jobs', 'now']);
    }
    expect(tables['todo.task_links'].map((l) => [l.task_id, l.relation, l.role_id])).toEqual(
      todos().map((t, i) => [t.id, 'about', [ROLE_A, ROLE_B, ROLE_C][i]]),
    );

    expect(result).toMatchObject({ kind: 'add_todos', op: 'insert', subjectRef: `todo.tasks:${todos()[0].id}` });
    expect(result.summary).toBe(
      'Dash added 3 todos, one for each row of set 1, due 2026-10-20, tagged jobs and now: "Follow up with Acme about Product Manager", "Follow up with Beta Labs about Staff PM" and "Follow up with Founding PM about Founding PM".',
    );
    const kept = await keep(result);
    expect(changeSentence(kept, true)).toContain('Added 3 todos');
    expect(changeHref(kept)).toBe('/todo/all');
  });

  it('names an application by its role and company, not its next action', async () => {
    const set = addSet('job_search.applications', [APP_A]);
    ok(await apply({ set, title: 'Chase {company} on {title}' }));
    expect(todos().map((t) => t.title)).toEqual(['Chase Beta Labs on Staff PM']);
    expect(tables['todo.task_links'][0]).toMatchObject({ application_id: APP_A });
    // No date, so it is tagged eventually.
    expect(tables['todo.task_tags'].map((row) => row.tag)).toEqual(['eventually']);
  });

  it('refuses a set it does not have, one over the cap, and rows that are not theirs', async () => {
    expect(refused(await apply({ set: 'set 4', title: 'x {title}' }))).toContain('There is no set 4');
    const big = addSet('job_search.roles', [], SET_CAP + 1);
    expect(refused(await apply({ set: big, title: 'x {title}' }))).toContain(`more than the ${SET_CAP}`);
    const theirs = addSet('job_search.roles', [ROLE_A, NOT_MINE]);
    expect(refused(await apply({ set: theirs, title: 'x {title}' }))).toContain('1 of the rows in set 2 are not theirs');
    expect(todos()).toEqual([]);
  });

  it('wants {title} where a todo cannot point at the rows, and {company} only for roles', async () => {
    tables['learn.readings'] = [];
    const tasks = addSet('todo.tasks', ['00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2']);
    expect(refused(await apply({ set: tasks, title: 'Review it' }))).toContain('put {title} in the title');
    const roles = addSet('job_search.roles', [ROLE_A]);
    expect(refused(await apply({ set: tasks, title: 'Email {company}' }))).toContain('{company} names a role');
    // A role can be pointed at, so the same title for each is allowed.
    ok(await apply({ set: roles, title: 'Review it' }));
    expect(todos().map((t) => t.title)).toEqual(['Review it']);
  });

  it('takes back the todos already made when one fails', async () => {
    const set = addSet('job_search.roles', [ROLE_A, ROLE_B]);
    let calls = 0;
    const failing: DashWriteContext['createTask'] = async (...args) => {
      calls += 1;
      return calls === 2 ? { id: null, error: 'boom' } : createTask(...args);
    };
    const result = await apply({ set, title: 'Follow up on {title}' }, context({ createTask: failing }));
    expect(result.ok).toBe(false);
    expect(todos()).toEqual([]);
  });

  it('is refused while Todo is switched off', async () => {
    const set = addSet('job_search.roles', [ROLE_A]);
    expect(refused(await apply({ set, title: '{title}' }, context({ enabledModules: ['jobs'] })))).toContain('switched off');
  });

  it('Undo takes out the todos still untouched and leaves the ones they changed', async () => {
    const set = addSet('job_search.roles', [ROLE_A, ROLE_B, ROLE_C]);
    const kept = await keep(ok(await apply({ set, title: 'Follow up on {title}' })));
    const [first, second, third] = todos().map((t) => t.id);
    todos().find((t) => t.id === second)!.title = 'Follow up on Staff PM by phone';
    todos().find((t) => t.id === third)!.status = 'done';

    const undone = await undoChange(deps(), kept.id);
    expect(undone).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect(todos().map((t) => t.id)).toEqual([second, third]);
    expect(todos().some((t) => t.id === first)).toBe(false);
  });

  it('Undo is refused when every todo has been touched since', async () => {
    const set = addSet('job_search.roles', [ROLE_A]);
    const kept = await keep(ok(await apply({ set, title: 'Follow up on {title}' })));
    tables['todo.task_tags'].push({ task_id: todos()[0].id, tag: 'calls' });
    const undone = await undoChange(deps(), kept.id);
    expect(undone).toMatchObject({ ok: false });
    expect(!undone.ok && undone.error).toContain('since');
    expect(todos()).toHaveLength(1);
  });
});
