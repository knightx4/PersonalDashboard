import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { undoDashAction } from '@/lib/core/dash-actions';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { ThreadDash } from '@/lib/dash/thread';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { undoDashTodayWith } from '@/lib/shell/dash-today';
import { insertMadeChange } from '@/lib/talk/changes';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '../../../tests/stubs/fake-schema-db';

/**
 * Dash's reply on a role runs the shared loop (plan #1465): it can write the
 * cover letter, recorded with the application before and after (plan #1459)
 * so undoing it puts the old letter back, and it can make Ask Dash's changes,
 * so "@dash remind me to follow up" adds a todo that Home can undo. The model
 * is a stubbed client; the database is one in memory.
 */

vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: vi.fn() }));

import { askDashOnRole } from './ask';

const ME = '00000000-0000-4000-8000-0000000000bb';
const ROLE = '00000000-0000-4000-8000-000000000201';
const APPLICATION = '00000000-0000-4000-8000-000000000202';
const TODO = '00000000-0000-4000-8000-000000000203';

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const call = (id: string, name: string, input: unknown) => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage: USAGE,
});

/** A model client that answers with each reply in turn, keeping what it was sent. */
function model(replies: unknown[]) {
  const sent: { model: string; tools: { name: string }[]; messages: { content: unknown }[] }[] = [];
  const client = {
    messages: {
      create: async (params: (typeof sent)[number]) => {
        sent.push(structuredClone(params));
        return replies[sent.length - 1];
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

function setup(coverLetter: string | null) {
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
      { id: APPLICATION, user_id: ME, role_id: ROLE, attempt: 1, status: 'drafting', cover_letter: coverLetter, updated_at: '2026-10-01T09:00:00Z' },
    ],
    'job_search.notes': [{ id: 'q', user_id: ME, role_id: ROLE, author: 'me', body: '@dash write my letter', created_at: '2026-10-03T08:00:00Z' }],
    'todo.tasks': [],
  };
  const dash = fakeDashDeps(tables, ME);
  const db = fakeSchemaDb(tables);
  const client = db('job_search') as unknown as AppSupabaseClient;
  const dashThread: ThreadDash = {
    today: '2026-10-03',
    execute: vi.fn(async () => ({ ok: true as const, rows: [] })),
    apply: (tool, args, seen, acts) =>
      tool.apply(
        {
          userId: ME,
          today: '2026-10-03',
          timezone: 'UTC',
          enabledModules: ['todo', 'jobs', 'goals'],
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
    saveChange: (made) => insertMadeChange(db('core') as unknown as CoreSupabaseClient, ME, null, made),
  };
  const changeDeps: ChangeDeps = {
    userId: ME,
    timezone: 'UTC',
    today: '2026-10-03',
    enabledModules: ['todo', 'jobs', 'goals'],
    core: db('core'),
    db: async (schema) => db(schema),
    goals: async () => db('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => '2026-10-03T12:00:00Z',
  };
  return { tables, dash, client, dashThread, changeDeps };
}

function ask(state: ReturnType<typeof setup>, anthropic: Anthropic, question = 'write my letter') {
  return askDashOnRole({
    client: state.client,
    userId: ME,
    roleId: ROLE,
    commentId: 'q',
    question,
    apiKey: 'key',
    dash: state.dash,
    dashThread: state.dashThread,
    anthropic,
  });
}

const replies = (tables: FakeTables) =>
  tables['job_search.notes'].filter((n) => n.author === 'claude').map((n) => n.body as string);

describe('Dash on a role', () => {
  it('runs the shared loop on Sonnet, with the lookups, the writes and the letter, and no hand-off', async () => {
    const state = setup(null);
    const { client, sent } = model([call('a', 'answer', { answer: 'It asks for Go.', cited: [] })]);
    await ask(state, client, 'what do they want?');
    expect(sent[0].model).toBe('claude-sonnet-5');
    const names = sent[0].tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search', 'todos', 'add_todo', 'add_role_note', 'write_cover_letter', 'answer']));
    expect(names).not.toContain('hand_off');
    expect(names).not.toContain('file_idea');
    expect(names).not.toContain('file_goal_record');
    expect(JSON.stringify(sent[0].messages[0].content)).toContain(`job_search.roles, ref ${ROLE}`);
    expect(replies(state.tables)).toEqual(['It asks for Go.']);
    expect(state.tables['core.dash_actions'] ?? []).toHaveLength(0);
  });

  it('adds the todo a comment asks for, recorded on the thread, and Home undoes it', async () => {
    const state = setup(null);
    const { client } = model([
      call('w', 'add_todo', { title: 'Follow up with the Acme recruiter', due_on: '2026-10-09' }),
      call('a', 'answer', { answer: 'Added a todo to follow up on Friday.', cited: [] }),
    ]);
    const outcome = await ask(state, client, 'remind me to follow up with the recruiter on Friday');
    expect(outcome).toEqual({ ok: true, message: 'Done, and said in the thread.' });
    expect(state.tables['todo.tasks']).toMatchObject([{ id: TODO, title: 'Follow up with the Acme recruiter', due_on: '2026-10-09' }]);
    expect(replies(state.tables)).toEqual(['Added a todo to follow up on Friday.']);

    const [action] = state.tables['core.dash_actions'];
    expect(action).toMatchObject({
      surface: 'thread',
      conversation_id: null,
      kind: 'add_todo',
      status: 'done',
      op: 'insert',
      subject_ref: `todo.tasks:${TODO}`,
    });

    const undone = await undoDashTodayWith(state.dash, action.id as string, (id) => undoChange(state.changeDeps, id));
    expect(undone).toEqual({ ok: true, paths: [] });
    expect(state.tables['todo.tasks']).toHaveLength(0);
    expect(state.tables['core.dash_actions'][0].status).toBe('undone');
  });

  it('writes the letter, recorded with the one it replaced, and undoing it puts that letter back', async () => {
    const state = setup('The letter I wrote myself.');
    const { client } = model([
      call('w', 'write_cover_letter', { cover_letter: 'Dear Acme, the new letter.', unsupported_claims: ['ten years'] }),
      call('a', 'answer', { answer: 'I rewrote the letter around the role.', cited: [] }),
    ]);

    const outcome = await ask(state, client);
    expect(outcome).toEqual({ ok: true, message: 'Cover letter written, under Application.' });
    expect(state.tables['job_search.applications'][0].cover_letter).toBe('Dear Acme, the new letter.');
    const [reply] = replies(state.tables);
    expect(reply).toContain('I rewrote the letter around the role.');
    expect(reply).toContain('- ten years');
    expect(reply).toContain('The letter it replaced:\n\nThe letter I wrote myself.');

    const [action] = state.tables['core.dash_actions'];
    expect(action).toMatchObject({
      surface: 'thread',
      kind: 'write_cover_letter',
      status: 'done',
      op: 'update',
      subject_ref: `job_search.applications:${APPLICATION}`,
      before_values: { cover_letter: 'The letter I wrote myself.' },
      after_values: { cover_letter: 'Dear Acme, the new letter.' },
      summary: 'Rewrote the cover letter for Staff Engineer at Acme.',
    });

    expect((await undoDashAction(state.dash, action.id as string)).ok).toBe(true);
    expect(state.tables['job_search.applications'][0].cover_letter).toBe('The letter I wrote myself.');
  });
});
