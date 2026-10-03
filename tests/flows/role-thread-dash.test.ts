/**
 * Flow: @dash on a job role adds a todo, Home lists it under what Dash did
 * today with an Undo and a link back to the role, and the Undo takes it away
 * (plan #1518, the design session of overhaul #1517; docs/CORE-AND-DASH-SPEC.md,
 * the path its Part 6 gives as the example).
 *
 * The parts it runs across, each the shared piece the spec's Contract names:
 * the role's thread in the shared store (lib/thread/store.ts), the role's own
 * reply (lib/jobs/role-thread/ask.ts) running the one loop (lib/dash/thread.ts,
 * lib/dash/loop.ts) with the registry's add_todo (lib/dash/writes.ts), the
 * record in core.dash_actions under the comment that asked (lib/talk/changes.ts),
 * Home's list (lib/shell/dash-today.ts), the one undo rule
 * (lib/core/dash-actions.ts), and the role's move label (lib/jobs/move.ts
 * over lib/core/move.ts).
 *
 * The code path runs over the in-memory tables of tests/stubs/fake-schema-db.ts
 * with the model stubbed, since the app reaches the database through PostgREST
 * and the local test database has none. The second half writes the same record
 * to the local database as the person, so the shape the first half produces is
 * one the real schema, its foreign keys and its row level security accept.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { moveLabel } from '@/lib/core/move';
import { toRef } from '@/lib/core/refs';
import type { ThreadDash } from '@/lib/dash/thread';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { applicationMove, lastTurnEvent } from '@/lib/jobs/move';
import { loadDashToday, undoDashTodayWith } from '@/lib/shell/dash-today';
import { insertMadeChange } from '@/lib/talk/changes';
import { addThreadTurn, loadThread } from '@/lib/thread/store';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '../stubs/fake-schema-db';
import { admin, asUser, closeDb, createUser, truncateAll } from '../helpers/db-core';

vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: vi.fn() }));

const { askDashOnRole } = await import('@/lib/jobs/role-thread/ask');

const ME = '00000000-0000-4000-8000-0000000000cc';
const ROLE = '00000000-0000-4000-8000-000000000301';
const APPLICATION = '00000000-0000-4000-8000-000000000302';
const TODO = '00000000-0000-4000-8000-000000000303';
const TODAY = '2026-10-03';
const NOW = '2026-10-03T12:00:00.000Z';
const ROLE_REF = toRef('job_search.roles', ROLE);

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const call = (id: string, name: string, input: unknown) => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage: USAGE,
});

/** A model that adds the follow-up todo, then says so. */
const model = (() => {
  const replies = [
    call('w', 'add_todo', { title: 'Follow up with the Acme recruiter', due_on: '2026-10-09' }),
    call('a', 'answer', { answer: 'Added a todo to follow up with the recruiter on Friday.', cited: [] }),
  ];
  let sent = 0;
  return { messages: { create: async () => replies[sent++] } } as unknown as Anthropic;
})();

/** The account's tables: a role at Acme with a sent application, and no todos. */
function world() {
  const tables: FakeTables = {
    'job_search.roles': [
      {
        id: ROLE,
        user_id: ME,
        title: 'Staff Engineer',
        seniority: null,
        location: null,
        work_mode: null,
        jd_text: 'Build things.',
        requirement_matches: [],
        companies: { name: 'Acme', industry: null, stage: null, research: null },
      },
    ],
    'job_search.applications': [
      { id: APPLICATION, user_id: ME, role_id: ROLE, attempt: 1, status: 'submitted', cover_letter: null },
    ],
    'job_search.application_events': [
      { id: 'e1', user_id: ME, application_id: APPLICATION, kind: 'submitted', occurred_at: '2026-10-01T09:00:00Z' },
    ],
    'todo.tasks': [],
    'core.dash_actions': [],
  };
  const db = fakeSchemaDb(tables, NOW);
  const core = db('core') as unknown as CoreSupabaseClient;
  const dashThread: ThreadDash = {
    today: TODAY,
    execute: vi.fn(async () => ({ ok: true as const, rows: [] })),
    apply: (tool, args, seen, acts) =>
      tool.apply(
        {
          userId: ME,
          today: TODAY,
          timezone: 'UTC',
          enabledModules: ['todo', 'jobs'],
          db: async (schema) => db(schema),
          searchSources: [],
          seen,
          goals: async () => db('goals') as unknown as GoalsSupabaseClient,
          createTask: async (userId, input) => {
            tables['todo.tasks'].push({
              id: TODO,
              user_id: userId,
              title: input.title,
              body: input.body ?? null,
              status: 'open',
              due_on: input.dueOn ?? null,
              due_at: null,
              pinned: input.pinned ?? false,
              snoozed_until: null,
              parent_id: null,
            });
            return { id: TODO, error: null };
          },
          thread: acts,
        },
        args,
      ),
    // What threadDashInRequest keeps a write with, at a fixed time.
    saveChange: (made, cause) => insertMadeChange(core, ME, cause, made, NOW),
  };
  const changeDeps: ChangeDeps = {
    userId: ME,
    timezone: 'UTC',
    today: TODAY,
    enabledModules: ['todo', 'jobs'],
    core: db('core'),
    db: async (schema) => db(schema),
    goals: async () => db('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => NOW,
  };
  return {
    tables,
    jobs: db('job_search') as unknown as AppSupabaseClient,
    core: db('core'),
    dash: fakeDashDeps(tables, ME, NOW),
    dashThread,
    changeDeps,
  };
}

describe('@dash on a role adds a todo that Home lists with its Undo', () => {
  const state = world();
  let commentId: string;
  let actionId: string;

  it('shows whose move the role is, in the shared words', () => {
    const kinds = state.tables['job_search.application_events'].map((event) => event.kind as string);
    const move = applicationMove({ status: 'submitted', lastEvent: lastTurnEvent(kinds), companyName: 'Acme' });
    expect(move).not.toBeNull();
    expect(moveLabel(move!.move)).toMatchObject({ state: 'waiting', word: 'Waiting on Acme' });
  });

  it('keeps the comment in the role’s thread and answers it there', async () => {
    commentId = await addThreadTurn(state.jobs, {
      userId: ME,
      ref: ROLE_REF,
      author: 'me',
      body: '@dash remind me to follow up with the recruiter on Friday',
    });
    const outcome = await askDashOnRole({
      client: state.jobs,
      userId: ME,
      roleId: ROLE,
      commentId,
      question: 'remind me to follow up with the recruiter on Friday',
      apiKey: 'key',
      dash: state.dash,
      dashThread: state.dashThread,
      anthropic: model,
    });
    expect(outcome).toEqual({ ok: true, message: 'Done, and said in the thread.' });

    const thread = await loadThread(state.jobs, ROLE_REF, { userId: ME });
    expect(thread.map((turn) => turn.author)).toEqual(['me', 'claude']);
    expect(thread[1].body).toBe('Added a todo to follow up with the recruiter on Friday.');
    expect(state.tables['todo.tasks']).toMatchObject([{ id: TODO, title: 'Follow up with the Acme recruiter', due_on: '2026-10-09' }]);
  });

  it('records the todo as Dash’s, under the comment that asked for it', () => {
    const [conversation] = state.tables['core.conversations'];
    expect(conversation).toMatchObject({ subject_kind: 'row', subject_ref: ROLE_REF });
    const [action] = state.tables['core.dash_actions'];
    expect(action).toMatchObject({
      surface: 'thread',
      kind: 'add_todo',
      status: 'done',
      op: 'insert',
      subject_ref: `todo.tasks:${TODO}`,
      conversation_id: conversation.id,
      turn_id: commentId,
    });
    actionId = action.id as string;
  });

  it('lists it on Home under Todo, with Undo and a link back to the role', async () => {
    const groups = await loadDashToday(state.core, { userId: ME, today: TODAY, timezone: 'UTC' });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ workspace: 'todo', label: 'Todo' });
    expect(groups[0].entries).toMatchObject([
      { id: actionId, surface: 'thread', status: 'done', noUndo: null, from: `/jobs/roles/${ROLE}` },
    ]);
  });

  it('takes the todo away when Undo is pressed, and says so on Home', async () => {
    const undone = await undoDashTodayWith(state.dash, actionId, (id) => undoChange(state.changeDeps, id));
    expect(undone.ok).toBe(true);
    expect(state.tables['todo.tasks']).toHaveLength(0);

    const groups = await loadDashToday(state.core, { userId: ME, today: TODAY, timezone: 'UTC' });
    expect(groups[0].entries).toMatchObject([{ id: actionId, status: 'undone' }]);
  });
});

describe('the record that path writes, in the local database', () => {
  let person: string;
  let other: string;
  let roleId: string;

  beforeAll(async () => {
    await truncateAll();
    person = await createUser('role-flow@example.com');
    other = await createUser('role-flow-other@example.com');
    const [company] = await admin<{ id: string }[]>`
      insert into job_search.companies (user_id, name, slug) values (${person}, 'Acme', 'acme') returning id`;
    const [role] = await admin<{ id: string }[]>`
      insert into job_search.roles (user_id, company_id, title) values (${person}, ${company.id}, 'Staff Engineer')
      returning id`;
    roleId = role.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('accepts a thread write under the person’s own comment, and Home can read where it came from', async () => {
    const ref = `job_search.roles:${roleId}`;
    const row = await asUser(person, async (tx) => {
      const [{ turn }] = await tx<{ turn: string }[]>`
        select core.add_thread_turn(${person}, ${ref}, 'me', '@dash remind me to follow up') as turn`;
      const [{ conversation_id }] = await tx<{ conversation_id: string }[]>`
        select conversation_id from core.conversation_turns where id = ${turn}`;
      const [task] = await tx<{ id: string }[]>`
        insert into todo.tasks (user_id, title) values (${person}, 'Follow up with Acme') returning id`;
      await tx`
        insert into core.dash_actions (user_id, conversation_id, turn_id, surface, kind, input, status, done_at,
                                       subject_ref, op, summary)
        values (${person}, ${conversation_id}, ${turn}, 'thread', 'add_todo', '{}'::jsonb, 'done', now(),
                ${`todo.tasks:${task.id}`}, 'insert', 'Added the todo Follow up with Acme.')`;
      const [read] = await tx<{ subject_ref: string; turn_id: string }[]>`
        select c.subject_ref, a.turn_id
          from core.dash_actions a join core.conversations c on c.id = a.conversation_id
         where a.user_id = ${person} and a.surface = 'thread'`;
      return { ...read, turn };
    });
    expect(row).toEqual({ subject_ref: `job_search.roles:${roleId}`, turn_id: row.turn, turn: row.turn });
  });

  it('refuses a record under somebody else’s comment', async () => {
    const [{ turn, conversation_id }] = await admin<{ turn: string; conversation_id: string }[]>`
      select t.id as turn, t.conversation_id
        from core.conversation_turns t where t.user_id = ${person} limit 1`;
    await expect(
      asUser(other, (tx) => tx`
        insert into core.dash_actions (user_id, conversation_id, turn_id, surface, kind, input, status, done_at, op, summary)
        values (${other}, ${conversation_id}, ${turn}, 'thread', 'add_todo', '{}'::jsonb, 'done', now(), 'insert', 'x')`),
    ).rejects.toThrow();
  });
});
