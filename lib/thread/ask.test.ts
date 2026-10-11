import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ThreadDash } from '@/lib/dash/thread';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';

/**
 * @dash under a file (plan #1441): the reply comes from the shared loop, keyed
 * by the file's ref alone, and the message it is written from holds the
 * file's whole body. The model is a stubbed client; the database is one in
 * memory.
 */

const spent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: spent }));

import { askDashOnRow } from './ask';

const ME = '00000000-0000-4000-8000-0000000000cc';
const FILE = '00000000-0000-4000-8000-000000000301';
const REF = `core.files:${FILE}`;

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const call = (id: string, name: string, input: unknown) => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage: USAGE,
});

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

function setup() {
  const tables: FakeTables = {
    'core.files': [
      {
        id: FILE,
        user_id: ME,
        title: 'Moving to Lisbon: the costs',
        summary: 'Rent, visas and flights.',
        body: 'Rent in Lisbon runs to 1,400 euros a month for a one bedroom in Arroios.',
        made_by: 'claude',
        archived_at: null,
      },
    ],
    'core.conversation_turns': [
      { id: 'earlier', user_id: ME, ref: REF, author: 'me', role: 'user', body: 'Check the rent figure.', created_at: '2026-10-02T08:00:00Z' },
      { id: 'q', user_id: ME, ref: REF, author: 'me', role: 'user', body: '@dash what does it say rent is?', created_at: '2026-10-03T08:00:00Z' },
    ],
  };
  const db = fakeSchemaDb(tables);
  const dashThread: ThreadDash = {
    today: '2026-10-03',
    execute: vi.fn(async () => ({ ok: true as const, rows: [] })),
    apply: vi.fn(async () => ({ ok: false as const, error: 'unused' })),
    saveChange: vi.fn(async () => null),
  };
  return { tables, client: db('core'), dash: fakeDashDeps(tables, ME), dashThread };
}

function ask(state: ReturnType<typeof setup>, anthropic: Anthropic, apiKey: string | null = 'key') {
  return askDashOnRow({
    client: state.client,
    userId: ME,
    ref: REF,
    commentId: 'q',
    question: 'what does it say rent is?',
    apiKey,
    dash: state.dash,
    dashThread: state.dashThread,
    anthropic,
  });
}

const replies = (tables: FakeTables) =>
  tables['core.conversation_turns'].filter((t) => t.ref === REF && t.author === 'claude').map((t) => t.body);

describe('Dash under a file', () => {
  it('replies in the thread from the shared loop, having read the file', async () => {
    const state = setup();
    const { client, sent } = model([call('a', 'answer', { answer: 'It puts rent at 1,400 euros a month.', cited: [] })]);

    const outcome = await ask(state, client);

    expect(outcome).toEqual({ ok: true, message: 'Answered in the thread.' });
    expect(replies(state.tables)).toEqual(['It puts rent at 1,400 euros a month.']);
    expect(sent[0].model).toBe('claude-sonnet-5-5');
    const names = sent[0].tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search', 'open_row', 'add_todo', 'answer']));
    // Dev rows' own tools are not offered on a file.
    expect(names).not.toContain('file_idea');
    expect(names).not.toContain('write_cover_letter');

    const message = JSON.stringify(sent[0].messages[0].content);
    expect(message).toContain(`core.files, ref ${FILE}`);
    expect(message).toContain('1,400 euros a month for a one bedroom in Arroios');
    expect(message).toContain('Called: Moving to Lisbon: the costs');
    // The earlier turn is history; the question is not repeated in it.
    expect(message).toContain('Check the rent figure.');
    expect(message).not.toContain(ME);
    expect(spent).toHaveBeenCalledWith(ME, { module: 'core', operation: 'reply-to-comment' }, expect.any(Array));
  });

  it('says in the thread when there is no key to answer with', async () => {
    const state = setup();
    const { client, sent } = model([]);
    const outcome = await ask(state, client, null);
    expect(outcome.ok).toBe(false);
    expect(sent).toHaveLength(0);
    expect(replies(state.tables)).toEqual([
      'No ANTHROPIC_API_KEY on the deployment, so I cannot answer. Your comment is saved.',
    ]);
  });

  it('asks nothing when the row is gone', async () => {
    const state = setup();
    state.tables['core.files'] = [];
    const { client, sent } = model([]);
    expect(await ask(state, client)).toEqual({ ok: false, error: 'That row is no longer here, so nothing was asked.' });
    expect(sent).toHaveLength(0);
    expect(replies(state.tables)).toEqual([]);
  });
});

describe('Dash under a vault note', () => {
  const NOTE = '00000000-0000-4000-8000-000000000401';
  const NOTE_REF = `obsidian.notes:${NOTE}`;

  function noteState(path: string) {
    const state = setup();
    state.tables['obsidian.notes'] = [
      { id: NOTE, user_id: ME, path, title: 'Monday', body: 'Slept badly and skipped the run.' },
    ];
    state.tables['core.conversation_turns'].push({
      id: 'nq', user_id: ME, ref: NOTE_REF, author: 'me', role: 'user', body: '@dash what next?', created_at: '2026-10-03T09:00:00Z',
    });
    return state;
  }

  function askNote(state: ReturnType<typeof setup>, anthropic: Anthropic) {
    return askDashOnRow({
      client: state.client,
      userId: ME,
      ref: NOTE_REF,
      commentId: 'nq',
      question: 'what next?',
      apiKey: 'key',
      dash: state.dash,
      dashThread: state.dashThread,
      anthropic,
    });
  }

  it('sends a journal nothing and says why in the thread', async () => {
    const state = noteState('Me/2026-10-03.md');
    const { client, sent } = model([]);
    const outcome = await askNote(state, client);
    expect(outcome.ok).toBe(false);
    expect(sent).toHaveLength(0);
    const said = state.tables['core.conversation_turns'].filter((t) => t.ref === NOTE_REF && t.author === 'claude');
    expect(said.map((t) => t.body)).toEqual([
      'I do not read this note. Not read: notes in Me/ are journals. Your comment is saved.',
    ]);
  });

  it('answers on any other note without its path reaching the model', async () => {
    const state = noteState('Health/Monday.md');
    const { client, sent } = model([call('a', 'answer', { answer: 'Run on Wednesday.', cited: [] })]);
    const outcome = await askNote(state, client);
    expect(outcome.ok).toBe(true);
    const message = JSON.stringify(sent[0].messages[0].content);
    expect(message).toContain('Slept badly and skipped the run.');
    expect(message).not.toContain('Health/');
  });
});
