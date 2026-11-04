import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { CONNECTOR_WRITE_TOOLS, runConnectorWrite, type ConnectorWriteContext } from './writes';

/**
 * A session writes into its thread and the plan through the connector (plan
 * #2789.5): each tool writes its row as the verified person, a question keeps
 * its options, plan rows land proposed in the thread's own project, and each
 * write but read_thread is recorded in core.dash_actions for Home's Undo.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const PROJECT_THREAD = '00000000-0000-4000-8000-000000000001';
const APP_THREAD = '00000000-0000-4000-8000-000000000002';
const THEIRS = '00000000-0000-4000-8000-000000000003';
const ENDED = '00000000-0000-4000-8000-000000000004';
const FEATURE = '00000000-0000-4000-8000-000000000010';
const APP_FEATURE = '00000000-0000-4000-8000-000000000011';

const tool = (name: string) => CONNECTOR_WRITE_TOOLS.find((entry) => entry.definition.name === name)!;

let tables: FakeTables;

function ctx(): ConnectorWriteContext {
  const db = fakeSchemaDb(tables);
  return {
    userId: ME,
    learn: {} as never,
    core: db('core'),
    db: async (schema) => db(schema),
    later: vi.fn(),
    recordSpend: vi.fn(async () => undefined),
    anthropicApiKey: undefined,
    lookupDeadline: 0,
    account: { enabledModules: ['dev'], today: '2026-11-04' },
  };
}

function thread(id: string, extra: Record<string, unknown> = {}) {
  return { id, user_id: ME, title: 'Recipe import', project_id: null, session_id: null, state: 'queued', ...extra };
}

beforeEach(() => {
  tables = {
    'core.session_threads': [
      thread(PROJECT_THREAD, { project_id: 'recipes', session_id: 'cse_1' }),
      thread(APP_THREAD),
      thread(THEIRS, { user_id: OTHER }),
      thread(ENDED, { state: 'ended' }),
    ],
    'core.session_messages': [],
    'core.dash_actions': [],
    'core.thread_turns': [],
    'public.plan_items': [
      { id: FEATURE, user_id: ME, number: 900, module: 'recipes', parent_id: null, title: 'Import', status: 'not_started', kind: 'build', position: 10 },
      { id: APP_FEATURE, user_id: ME, number: 901, module: 'jobs', parent_id: null, title: 'Jobs thing', status: 'not_started', kind: 'build', position: 10 },
    ],
    'public.plan_item_outlines': [
      { id: FEATURE, user_id: ME, number: 900, outline: '900' },
      { id: APP_FEATURE, user_id: ME, number: 901, outline: '901' },
    ],
  };
});

function actions() {
  return tables['core.dash_actions'].map((row) => ({ kind: row.kind, surface: row.surface, op: row.op, ref: row.subject_ref }));
}

describe('reply_in_thread', () => {
  it('writes a reply as the session, moves a queued thread to working and records it for Undo', async () => {
    const result = await runConnectorWrite(tool('reply_in_thread'), ctx(), { thread_id: APP_THREAD, body: 'Looking now.' });
    expect(result).toMatchObject({ ok: true });
    expect(tables['core.session_messages']).toEqual([
      expect.objectContaining({ user_id: ME, thread_id: APP_THREAD, author: 'session', kind: 'text', body: 'Looking now.', options: null }),
    ]);
    expect(tables['core.session_threads'].find((row) => row.id === APP_THREAD)?.state).toBe('working');
    const id = tables['core.session_messages'][0].id;
    expect(actions()).toEqual([{ kind: 'reply_in_thread', surface: 'routine', op: 'insert', ref: `core.session_messages:${id}` }]);
  });

  it('keeps a question with its options and puts the thread waiting on the person', async () => {
    const result = await runConnectorWrite(tool('reply_in_thread'), ctx(), {
      session_id: 'cse_1',
      kind: 'question',
      body: 'Merge?',
      options: ['Merge it', 'Not yet'],
    });
    expect(result).toMatchObject({ ok: true, rows: [{ detail: { kind: 'question', options: '["Merge it","Not yet"]' } }] });
    expect(tables['core.session_messages'][0]).toMatchObject({ thread_id: PROJECT_THREAD, options: ['Merge it', 'Not yet'] });
    expect(tables['core.session_threads'].find((row) => row.id === PROJECT_THREAD)?.state).toBe('waiting');
  });

  it('writes a mockup with its link', async () => {
    const url = 'https://claude.ai/artifact/abc';
    expect(await runConnectorWrite(tool('reply_in_thread'), ctx(), { thread_id: APP_THREAD, kind: 'mockup', artifact_url: url })).toMatchObject({ ok: true });
    expect(tables['core.session_messages'][0]).toMatchObject({ kind: 'mockup', artifact_url: url, body: '' });
  });

  it('gives an unclaimed thread the session id it was named with', async () => {
    await runConnectorWrite(tool('reply_in_thread'), ctx(), { thread_id: APP_THREAD, session_id: 'cse_9', body: 'Hi' });
    expect(tables['core.session_threads'].find((row) => row.id === APP_THREAD)?.session_id).toBe('cse_9');
  });

  it.each([
    [{ thread_id: APP_THREAD, kind: 'question', body: 'Merge?', options: ['Yes'] }, 'options must list 2 to 4.'],
    [{ thread_id: APP_THREAD, kind: 'question', body: 'Merge?', options: ['a', 'b', 'c', 'd', 'e'] }, 'options must list 2 to 4.'],
    [{ thread_id: APP_THREAD, body: 'x', options: ['a', 'b'] }, 'Only a question takes options.'],
    [{ thread_id: APP_THREAD, kind: 'mockup', body: 'x' }, 'A mockup needs artifact_url.'],
    [{ thread_id: APP_THREAD, kind: 'mockup', artifact_url: 'http://x.test' }, 'artifact_url must be an https link.'],
    [{ thread_id: APP_THREAD }, 'Write a body, or give artifact_url.'],
    [{ body: 'x' }, 'Name the thread: give thread_id or session_id.'],
    [{ thread_id: THEIRS, body: 'x' }, `No thread ${THEIRS}.`],
    [{ thread_id: ENDED, body: 'x' }, 'That thread has ended, so nothing more can be written in it.'],
    [{ thread_id: PROJECT_THREAD, session_id: 'cse_2', body: 'x' }, 'That thread belongs to another session.'],
  ])('refuses %j', async (input, error) => {
    expect(await runConnectorWrite(tool('reply_in_thread'), ctx(), input)).toEqual({ ok: false, error });
    expect(tables['core.session_messages']).toEqual([]);
  });
});

describe('read_thread', () => {
  beforeEach(() => {
    tables['core.session_messages'] = [
      { id: 'm1', user_id: ME, thread_id: APP_THREAD, author: 'session', kind: 'question', body: 'Merge?', options: ['Yes', 'No'], artifact_url: null, attachment_path: null, delivered_at: null, answer: 'Yes', answered_at: '2026-11-04T10:05:00Z', created_at: '2026-11-04T10:00:00Z' },
      { id: 'm2', user_id: ME, thread_id: APP_THREAD, author: 'person', kind: 'text', body: 'Also fix the title', options: null, artifact_url: null, attachment_path: null, delivered_at: null, answer: null, answered_at: null, created_at: '2026-11-04T10:06:00Z' },
      { id: 'm3', user_id: OTHER, thread_id: APP_THREAD, author: 'person', kind: 'text', body: 'not theirs', options: null, artifact_url: null, attachment_path: null, delivered_at: null, answer: null, answered_at: null, created_at: '2026-11-04T10:07:00Z' },
    ];
  });

  it('returns what was written and answered since a point, and marks the person\'s messages delivered', async () => {
    const result = await runConnectorWrite(tool('read_thread'), ctx(), { thread_id: APP_THREAD, since: '2026-11-04T10:01:00Z' });
    expect(result).toMatchObject({ ok: true, totals: { thread_id: APP_THREAD, state: 'queued', next_since: '2026-11-04T10:06:00Z' } });
    if (!result.ok) return;
    expect(result.rows.map((row) => row.ref)).toEqual(['core.session_messages:m1', 'core.session_messages:m2']);
    expect(result.rows[0].detail).toMatchObject({ answer: 'Yes' });
    expect(tables['core.session_messages'].find((row) => row.id === 'm2')?.delivered_at).toEqual(expect.any(String));
    expect(tables['core.session_messages'].find((row) => row.id === 'm3')?.delivered_at).toBeNull();
    expect(actions()).toEqual([]);
  });

  it('reads from the start without since', async () => {
    const result = await runConnectorWrite(tool('read_thread'), ctx(), { thread_id: APP_THREAD });
    expect(result.ok && result.rows.map((row) => row.ref)).toEqual(['core.session_messages:m1', 'core.session_messages:m2']);
  });
});

describe('the plan writes', () => {
  it('propose_feature writes the feature and its steps proposed in the thread\'s project', async () => {
    const result = await runConnectorWrite(tool('propose_feature'), ctx(), {
      thread_id: PROJECT_THREAD,
      title: 'Import from a link',
      done_when: 'A pasted link becomes a recipe.',
      steps: [
        { title: 'Read the page', done_when: 'The parser returns the ingredients.' },
        { title: 'Save it', done_when: 'The recipe is listed.', size: 's' },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    const added = tables['public.plan_items'].slice(2);
    expect(added).toEqual([
      expect.objectContaining({ user_id: ME, module: 'recipes', parent_id: null, status: 'proposed', kind: 'build', acceptance: 'A pasted link becomes a recipe.', position: 20 }),
      expect.objectContaining({ module: 'recipes', parent_id: added[0].id, status: 'proposed', title: 'Read the page', position: 10 }),
      expect.objectContaining({ module: 'recipes', parent_id: added[0].id, status: 'proposed', title: 'Save it', size: 's', position: 20 }),
    ]);
    expect(actions()).toEqual([{ kind: 'propose_feature', surface: 'routine', op: 'insert', ref: `public.plan_items:${added[0].id}` }]);
  });

  it('a thread on this app writes in the workspace named, never a project', async () => {
    const input = { thread_id: APP_THREAD, title: 'X', done_when: 'Y', steps: [{ title: 'Z', done_when: 'W' }] };
    expect(await runConnectorWrite(tool('propose_feature'), ctx(), { ...input, module: 'recipes' })).toEqual({
      ok: false,
      error: 'recipes is not a workspace of this app.',
    });
    expect(await runConnectorWrite(tool('propose_feature'), ctx(), { ...input, module: 'jobs' })).toMatchObject({ ok: true });
    expect(tables['public.plan_items'][2]).toMatchObject({ module: 'jobs', status: 'proposed' });
  });

  it('a project\'s thread cannot write in another section', async () => {
    const input = { thread_id: PROJECT_THREAD, title: 'X', done_when: 'Y', steps: [{ title: 'Z', done_when: 'W' }], module: 'jobs' };
    expect(await runConnectorWrite(tool('propose_feature'), ctx(), input)).toEqual({
      ok: false,
      error: 'This thread works on recipes, so its plan rows go in that project.',
    });
  });

  it('add_plan_step writes a proposed step under a parent named by outline', async () => {
    const result = await runConnectorWrite(tool('add_plan_step'), ctx(), {
      thread_id: PROJECT_THREAD,
      parent: '#900',
      title: 'Handle a missing image',
      done_when: 'A recipe without a picture still saves.',
    });
    expect(result).toMatchObject({ ok: true });
    expect(tables['public.plan_items'][2]).toMatchObject({ parent_id: FEATURE, module: 'recipes', status: 'proposed', kind: 'build', position: 10 });
    expect(actions()).toEqual([expect.objectContaining({ kind: 'add_plan_step' })]);
  });

  it('add_plan_step refuses a parent outside the thread\'s project', async () => {
    expect(
      await runConnectorWrite(tool('add_plan_step'), ctx(), { thread_id: PROJECT_THREAD, parent: '901', title: 'X', done_when: 'Y' }),
    ).toEqual({ ok: false, error: '#901 is not in recipes, the project this thread works on.' });
    expect(
      await runConnectorWrite(tool('add_plan_step'), ctx(), { thread_id: APP_THREAD, parent: '900', title: 'X', done_when: 'Y' }),
    ).toEqual({ ok: false, error: "#900 is in a project's section; this thread works on this app." });
  });

  it('write_decision writes a proposed question with lettered options and the recommendation', async () => {
    const result = await runConnectorWrite(tool('write_decision'), ctx(), {
      thread_id: PROJECT_THREAD,
      parent: FEATURE,
      question: 'Which parser?',
      options: ['A — Use the schema.org data. Most sites have it.', 'Read the page text. Works everywhere, less exact.'],
      recommend: 'A: it is what the sites publish for this.',
    });
    expect(result).toMatchObject({ ok: true });
    expect(tables['public.plan_items'][2]).toMatchObject({
      parent_id: FEATURE,
      module: 'recipes',
      status: 'proposed',
      kind: 'decision',
      title: 'Which parser?',
      detail:
        'A — Use the schema.org data. Most sites have it.\nB — Read the page text. Works everywhere, less exact.\nRecommend A: it is what the sites publish for this.',
    });
    expect(actions()).toEqual([expect.objectContaining({ kind: 'write_decision' })]);
  });

  it('write_decision refuses a title that is not a question', async () => {
    expect(
      await runConnectorWrite(tool('write_decision'), ctx(), { thread_id: PROJECT_THREAD, parent: '900', question: 'Parser', options: ['a', 'b'], recommend: 'A' }),
    ).toEqual({ ok: false, error: 'question must be one sentence ending in a question mark.' });
  });
});
