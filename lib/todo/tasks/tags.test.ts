import { describe, expect, it, vi } from 'vitest';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { sortTags, tagList, tagName } from '@/lib/todo/tasks/tags';

vi.mock('@/lib/todo/auth/server', () => ({ createTodoClient: vi.fn() }));

const { addTaskTag, insertTask, removeTaskTag } = await import('@/lib/todo/tasks/write');
const { loadOpenTasks } = await import('@/lib/todo/tasks/load');
const { taskInput } = await import('@/lib/todo/tasks/input');

describe('tagName', () => {
  it('trims and lowercases', () => {
    expect(tagName.parse('  Home ')).toBe('home');
  });

  it('refuses a blank tag, whitespace included', () => {
    expect(tagName.safeParse('').success).toBe(false);
    expect(tagName.safeParse('   ').success).toBe(false);
  });

  it('holds a tag to 40 characters', () => {
    expect(tagName.safeParse('x'.repeat(40)).success).toBe(true);
    expect(tagName.safeParse('x'.repeat(41)).success).toBe(false);
  });
});

describe('tagList', () => {
  it('refuses the same tag twice, however it was cased', () => {
    expect(tagList.safeParse(['home', ' HOME']).success).toBe(false);
    expect(tagList.parse(['Home', 'car'])).toEqual(['home', 'car']);
  });

  it('is optional on a new task, and empty when left out', () => {
    const parsed = taskInput.parse({ title: 'Wash the car', body: '', dueOn: '', dueTime: '' });
    expect(parsed.tags).toEqual([]);
  });
});

describe('sortTags', () => {
  it('sorts by name', () => {
    expect(sortTags(['home', 'car', 'errands'])).toEqual(['car', 'errands', 'home']);
  });
});

/**
 * A stand-in for todo.tasks and todo.task_tags that keeps the two rules the
 * database holds (a tag is unique per task; deleting a task deletes its tags),
 * so the library's round trip can be checked without one. The rules
 * themselves are tested against Postgres in tests/rls-todo.test.ts.
 */
function fakeTodo() {
  const tasks: Record<string, unknown>[] = [];
  const tags: { task_id: string; tag: string }[] = [];
  let next = 0;

  function from(table: string) {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'insert' | 'delete' = 'select';
    let inserted: Record<string, unknown>[] = [];
    let error: { message: string; code?: string } | null = null;

    const matches = (row: Record<string, unknown>) =>
      filters.every(([column, value]) => row[column] === value);

    function run() {
      if (op === 'insert') return { data: inserted, error };
      if (op === 'delete') {
        if (table === 'tasks') {
          const gone = tasks.filter(matches).map((row) => row.id);
          tasks.splice(0, tasks.length, ...tasks.filter((row) => !matches(row)));
          tags.splice(0, tags.length, ...tags.filter((tag) => !gone.includes(tag.task_id)));
        } else {
          tags.splice(0, tags.length, ...tags.filter((tag) => !matches(tag)));
        }
        return { data: null, error: null };
      }
      if (table !== 'tasks') return { data: tags.filter(matches), error: null };
      const data = tasks.filter(matches).map((row) => ({
        ...row,
        task_tags: tags.filter((tag) => tag.task_id === row.id).map(({ tag }) => ({ tag })),
      }));
      return { data, error: null };
    }

    const query = {
      select: () => query,
      insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
        op = 'insert';
        const list = Array.isArray(rows) ? rows : [rows];
        if (table === 'tasks') {
          inserted = list.map((row) => ({ id: `t${++next}`, status: 'open', ...row }));
          tasks.push(...inserted);
        } else {
          const all = [...tags];
          for (const row of list as { task_id: string; tag: string }[]) {
            if (all.some((tag) => tag.task_id === row.task_id && tag.tag === row.tag)) {
              error = { message: 'duplicate key value violates unique constraint', code: '23505' };
              return query;
            }
            all.push(row);
          }
          tags.splice(0, tags.length, ...all);
          inserted = list;
        }
        return query;
      },
      delete() {
        op = 'delete';
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return query;
      },
      or: () => query,
      limit: () => query,
      single: () => Promise.resolve({ data: run().data?.[0] ?? null, error }),
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error }),
      then: (resolve: (value: ReturnType<typeof run>) => unknown) => resolve(run()),
    };
    return query;
  }

  return { client: { from } as unknown as TodoSupabaseClient, tasks, tags };
}

const owner = 'user-a';
const input = (tags: string[]) =>
  taskInput.parse({ title: 'Wash the car', body: '', dueOn: '', dueTime: '', tags });

describe('tags through the task library', () => {
  it('writes a task with tags and reads it back with them', async () => {
    const db = fakeTodo();
    const { id, error } = await insertTask(db.client, owner, input(['Home', 'car']), 'UTC');
    expect(error).toBeNull();

    const [task] = await loadOpenTasks(owner, db.client);
    expect(task.id).toBe(id);
    expect(task.tags).toEqual(['car', 'home']);
  });

  it('refuses a duplicate or blank tag on a new task, and writes no task', async () => {
    const db = fakeTodo();
    const duplicate = await insertTask(db.client, owner, { ...input([]), tags: ['home', 'home'] }, 'UTC');
    const blank = await insertTask(db.client, owner, { ...input([]), tags: [' '] }, 'UTC');
    expect(duplicate.error).toMatch(/twice/);
    expect(blank.error).toMatch(/needs a name/);
    expect(db.tasks).toEqual([]);
  });

  it('adds and removes a tag, and refuses one the task already carries or a blank one', async () => {
    const db = fakeTodo();
    const { id } = await insertTask(db.client, owner, input([]), 'UTC');

    expect(await addTaskTag(owner, id!, ' Errands ', db.client)).toEqual({ tag: 'errands', error: null });
    expect((await addTaskTag(owner, id!, 'ERRANDS', db.client)).error).toMatch(/already tagged errands/);
    expect((await addTaskTag(owner, id!, '  ', db.client)).error).toMatch(/needs a name/);

    expect((await loadOpenTasks(owner, db.client))[0].tags).toEqual(['errands']);

    expect(await removeTaskTag(owner, id!, 'Errands', db.client)).toEqual({ error: null });
    expect((await loadOpenTasks(owner, db.client))[0].tags).toEqual([]);
  });

  it('will not tag a task belonging to somebody else', async () => {
    const db = fakeTodo();
    const { id } = await insertTask(db.client, owner, input([]), 'UTC');

    expect((await addTaskTag('user-b', id!, 'mine', db.client)).error).toBe('No such task.');
    expect(db.tags).toEqual([]);
  });
});
