import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';

/**
 * Making a todo from a newsletter story (plan #1369).
 *
 * Against a small in-memory stand-in for todo.tasks and todo.task_links,
 * because what is checked here is what makeStoryTask decides: one open task
 * per story however often it is made, titled with the headline and linked to
 * the saved story, a finished task not counting, and a refused link leaving
 * no task behind. createTask, linkTask and setTaskStatus write into the same
 * stand-in, the way they write into Postgres. That a link can point at a
 * saved story at all is checked in Postgres by tests/news-story-pointers.test.ts.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tasks: [] as Record<string, unknown>[],
  task_links: [] as Record<string, unknown>[],
  next: 0,
  refuseLink: false,
}));

vi.mock('@/lib/todo/tasks/write', async () => {
  const { taskInput } = await import('@/lib/todo/tasks/input');
  return {
    taskInput,
    createTask: async (userId: string, input: { title: string; body: string | null }) => {
      const id = `task-${(db.next += 1)}`;
      db.tasks.push({ id, user_id: userId, title: input.title, body: input.body, status: 'open', created_at: db.next });
      return { id, error: null };
    },
    setTaskStatus: async (_userId: string, id: string, status: string) => {
      const task = db.tasks.find((t) => t.id === id);
      if (task) task.status = status;
      return { error: null };
    },
  };
});

vi.mock('@/lib/todo/links/write', () => ({
  linkTask: async (taskId: string, target: string, targetId: string) => {
    if (db.refuseLink) return { error: 'That is not yours to link to.' };
    expect(target).toBe('story');
    db.task_links.push({ task_id: taskId, relation: 'about', saved_story_id: targetId });
    return { error: null };
  },
}));

const { findOpenStoryTasks, makeStoryTask } = await import('./story');

function memoryClient(): TodoSupabaseClient {
  function from(table: 'tasks' | 'task_links') {
    const filters: ((row: Row) => boolean)[] = [];
    let ascending: string | null = null;
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, values: unknown[]) => (
        filters.push((row) => values.includes(row[column])), builder
      ),
      order: (column: string) => ((ascending = column), builder),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        let rows = db[table].filter((row) => filters.every((f) => f(row)));
        if (ascending) {
          const column = ascending;
          rows = [...rows].sort((a, b) => (a[column] as number) - (b[column] as number));
        }
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    return builder;
  }
  return { from } as unknown as TodoSupabaseClient;
}

const ME = '00000000-0000-4000-8000-000000000001';
const STORY = { id: 'story-1', headline: '  The quiet return of the tram ' };

beforeEach(() => {
  db.tasks = [];
  db.task_links = [];
  db.next = 0;
  db.refuseLink = false;
});

describe('makeStoryTask', () => {
  it('makes one open task from a story made a todo twice, titled with the headline and linked to it', async () => {
    const client = memoryClient();

    const first = await makeStoryTask(client, ME, STORY, 'Europe/London');
    const second = await makeStoryTask(client, ME, STORY, 'Europe/London');

    expect(first.created).toBe(true);
    expect(second).toEqual({ taskId: first.taskId, created: false });
    const open = db.tasks.filter((t) => t.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: first.taskId, title: 'The quiet return of the tram', body: null });
    expect(db.task_links).toEqual([
      { task_id: first.taskId, relation: 'about', saved_story_id: 'story-1' },
    ]);
  });

  it('makes a new task once the first one is done', async () => {
    const client = memoryClient();
    const first = await makeStoryTask(client, ME, STORY, 'UTC');
    db.tasks[0].status = 'done';

    const again = await makeStoryTask(client, ME, STORY, 'UTC');

    expect(again.created).toBe(true);
    expect(again.taskId).not.toBe(first.taskId);
  });

  it('drops the task when the link is refused', async () => {
    db.refuseLink = true;

    await expect(makeStoryTask(memoryClient(), ME, STORY, 'UTC')).rejects.toThrow(/not yours/);
    expect(db.tasks.map((t) => t.status)).toEqual(['dropped']);
  });
});

describe('findOpenStoryTasks', () => {
  it('gives each story its oldest open task and leaves out stories with none', async () => {
    db.tasks.push(
      { id: 't1', status: 'done', created_at: 1 },
      { id: 't2', status: 'open', created_at: 2 },
      { id: 't3', status: 'open', created_at: 3 },
      { id: 't4', status: 'open', created_at: 4 },
    );
    db.task_links.push(
      { task_id: 't1', relation: 'about', saved_story_id: 'a' },
      { task_id: 't3', relation: 'about', saved_story_id: 'a' },
      { task_id: 't2', relation: 'about', saved_story_id: 'a' },
      { task_id: 't4', relation: 'source', saved_story_id: 'b' },
    );

    const found = await findOpenStoryTasks(memoryClient(), ['a', 'b', 'c', 'a']);

    expect(Object.fromEntries(found)).toEqual({ a: 't2' });
  });

  it('asks nothing for no stories', async () => {
    expect((await findOpenStoryTasks({} as TodoSupabaseClient, [])).size).toBe(0);
  });
});
