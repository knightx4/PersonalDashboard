import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { answerCall, scriptedModel, stubThreadDash, toolCall, toolResults } from '../../tests/stubs/dash-model';
import { fakeDashDeps } from '../../tests/stubs/fake-schema-db';

/**
 * Dash's reply on a dev row runs the shared loop (plan #1465): the lookups
 * and writes Ask has, and the row's own tools, which carry out the fixed list
 * in act.ts and pass to a session what needs the code read. The row, the
 * actions and the session are stubbed; the model is a scripted client.
 */

const mocks = vi.hoisted(() => ({
  carryOut: vi.fn(),
  startRoutineRun: vi.fn(),
  inserted: [] as Record<string, unknown>[],
}));

vi.mock('./act', () => ({ carryOut: mocks.carryOut }));
vi.mock('@/lib/plan/runs', () => ({ startRoutineRun: mocks.startRoutineRun }));
vi.mock('@/lib/feedback/routine', () => ({ planRoutine: () => ({ id: 'r', token: 't' }) }));
vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: vi.fn() }));
vi.mock('@/lib/writing/reply-check', () => ({ checkReplyAfterResponse: vi.fn() }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ ANTHROPIC_API_KEY: 'key' }) }));
vi.mock('@/lib/ideas/load', () => ({
  IDEA_COLUMNS: '*',
  ideaRowFrom: () => ({ id: 'idea-1', body: 'Show the count on Home', module: null, source: 'me', thread: [] }),
}));
// The thread is read from and written to the shared store (plan #1470).
vi.mock('@/lib/thread/store', async (original) => ({
  ...(await original<typeof import('@/lib/thread/store')>()),
  loadThread: vi.fn(async () => []),
  addThreadTurn: vi.fn(async (_client: unknown, turn: Record<string, unknown>) => {
    mocks.inserted.push({ table: 'thread', ...turn });
    return 'turn-1';
  }),
}));
vi.mock('./context', async (original) => ({
  ...(await original<typeof import('./context')>()),
  ideaContext: () => '# An idea\n\nShow the count on Home',
}));

import { askDash } from './ask';

const IDEA = '00000000-0000-4000-8000-000000000401';

const supabase = {
  from: (table: string) => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: IDEA } }) }) }) }),
    insert: async (row: Record<string, unknown>) => {
      mocks.inserted.push({ table, ...row });
      return { error: null };
    },
  }),
} as unknown as SupabaseClient;

let model = scriptedModel([]);

function ask(question: string) {
  return askDash({
    supabase,
    userId: 'u',
    target: 'idea',
    id: IDEA,
    commentId: 'c',
    question,
    dash: fakeDashDeps({}, 'u'),
    dashThread: stubThreadDash(),
    anthropic: model.client,
  });
}

const said = () => mocks.inserted.filter((row) => row.table === 'thread').map((row) => row.body);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
});

describe('Dash on a dev row', () => {
  it('answers on Sonnet with the lookups, the writes and the row\'s own tools', async () => {
    model = scriptedModel([answerCall('It would sit under Today.')]);
    const outcome = await ask('where would this go?');
    expect(outcome).toEqual({ ok: true, message: 'Answered in the thread.' });
    expect(model.sent[0].model).toBe('claude-sonnet-5-5');
    const names = model.sent[0].tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['search', 'read_dev_row', 'add_todo', 'file_idea', 'file_note', 'add_step', 'reword', 'build_step', 'pass_to_session']),
    );
    // A step is sent only from a step or a raise, and nothing here belongs to a goal or a role.
    expect(names).not.toContain('send_step');
    expect(names).not.toContain('file_goal_record');
    expect(names).not.toContain('write_cover_letter');
    expect(JSON.stringify(model.sent[0].messages[0].content)).toContain(`public.ideas, ref ${IDEA}`);
    expect(said()).toEqual(['It would sit under Today.']);
  });

  it('carries out an instruction through act.ts and shows what it did under the reply', async () => {
    mocks.carryOut.mockResolvedValue({ ok: true, said: 'Filed on the notes queue as a bug, open:\n\nThe count is wrong.', redraw: '/dev/bugs' });
    model = scriptedModel([
      toolCall('n', 'file_note', { text: 'The count is wrong.', kind: 'bug' }),
      answerCall('Written up as a bug.'),
    ]);
    const outcome = await ask('write this up as a bug');
    expect(mocks.carryOut).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'idea', id: IDEA, action: expect.objectContaining({ name: 'file_note', text: 'The count is wrong.', kind: 'bug' }) }),
    );
    expect(outcome).toEqual({ ok: true, message: 'Done, and said in the thread.', redraw: '/dev/bugs' });
    expect(said()).toEqual(['Written up as a bug.\n\nFiled on the notes queue as a bug, open:\n\nThe count is wrong.']);
  });

  it('passes what needs the code to a session, and writes nothing until it answers', async () => {
    mocks.startRoutineRun.mockResolvedValue({ ok: true, runId: 'run' });
    model = scriptedModel([
      toolCall('p', 'pass_to_session', { why: 'It needs the Home query read.', instruction: false }),
      answerCall('I passed that to a session.'),
    ]);
    const outcome = await ask('why is the count off by one?');
    expect(mocks.startRoutineRun).toHaveBeenCalledWith(expect.objectContaining({ job: 'comment' }));
    expect(outcome).toEqual({ ok: true, message: 'A session is reading the code. Its answer lands in this thread.' });
    expect(said()).toEqual([]);
  });

  it('tells Dash why an action was refused', async () => {
    mocks.carryOut.mockResolvedValue({ ok: false, why: 'That is longer than an idea can be.' });
    model = scriptedModel([toolCall('i', 'file_idea', { text: 'x' }), answerCall('That was too long to file.')]);
    await ask('file it');
    expect(toolResults(model.sent)).toEqual(['That is longer than an idea can be.']);
    expect(said()).toEqual(['That was too long to file.']);
  });
});
