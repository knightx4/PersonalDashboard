import { describe, expect, it, vi } from 'vitest';
import { CONNECTOR_WRITE_TOOLS, runConnectorWrite, type ConnectorWriteContext } from './writes';

/**
 * The connector's Learn writes (plan #1808) refuse bad input before reaching
 * the database, as an error the model can read and correct.
 */

const tool = (name: string) => CONNECTOR_WRITE_TOOLS.find((entry) => entry.definition.name === name)!;

function ctx(): ConnectorWriteContext {
  const touched = vi.fn(() => {
    throw new Error('the database was reached');
  });
  return {
    userId: 'me',
    learn: { from: touched } as never,
    core: { rpc: touched } as never,
    later: vi.fn(),
    recordSpend: vi.fn(async () => undefined),
    anthropicApiKey: undefined,
    lookupDeadline: 0,
  };
}

describe('runConnectorWrite', () => {
  it('offers the Learn writes, then the quick note, the idea and the job lead', () => {
    expect(CONNECTOR_WRITE_TOOLS.map((entry) => entry.definition.name)).toEqual([
      'add_to_reading_list',
      'log_learning',
      'mark_read',
      'add_quick_note',
      'add_idea',
      'add_job_lead',
    ]);
  });

  it.each([
    ['add_to_reading_list', { items: [], subjects: ['Evals'] }, 'items must list at least one work.'],
    ['add_to_reading_list', { items: [{ title: 'DSPy' }] }, 'subjects must name at least one subject.'],
    ['add_to_reading_list', { items: [{ author: 'Stanford' }], subjects: ['Evals'] }, 'title is required.'],
    ['log_learning', { summary: 'x', subject: 'Evals' }, 'topic is required.'],
    ['log_learning', { topic: 'Evals', summary: 'x', subject: 'Evals', ideas: [{ name: 'A' }] }, 'claim is required.'],
    ['mark_read', {}, 'title is required.'],
    ['mark_read', { reading_id: 'not-an-id' }, "reading_id must be a reading's id."],
  ])('%s refuses %j', async (name, input, error) => {
    expect(await runConnectorWrite(tool(name), ctx(), input)).toEqual({ ok: false, error });
  });
});

/**
 * The quick note, the idea and the job lead (plan #1894.2) run Ask Dash's own
 * write tools on the service-role clients, and record each change as a
 * routine's so Home lists it with an Undo.
 */
describe('the writes shared with Ask Dash', () => {
  const ME = '00000000-0000-4000-8000-0000000000cc';
  const NOTE = '00000000-0000-4000-8000-000000000d01';

  async function shared(account: ConnectorWriteContext['account'] = { enabledModules: ['vault', 'dev', 'jobs'], today: '2026-10-13' }) {
    const { fakeSchemaDb } = await import('../../tests/stubs/fake-schema-db');
    const tables: Record<string, Record<string, unknown>[]> = {
      'core.dash_actions': [],
      'public.ideas': [],
      'obsidian.notes': [],
    };
    const client = fakeSchemaDb(tables);
    const context: ConnectorWriteContext = {
      ...ctx(),
      userId: ME,
      core: client('core'),
      db: async (schema) => client(schema),
      fileQuickNote: async (text) => {
        tables['obsidian.notes'].push({ id: NOTE, user_id: ME, path: 'Inbox/A thought.md', title: 'A thought', body: text });
        return { ok: true, noteId: NOTE, path: 'Inbox/A thought.md', title: 'A thought', blobSha: 'sha-1' };
      },
      account,
    };
    return { tables, context };
  }

  it('saves a quick note and records it with the blob SHA its Undo needs', async () => {
    const { tables, context } = await shared();
    const result = await runConnectorWrite(tool('add_quick_note'), context, { text: 'A thought worth keeping' });
    expect(result).toMatchObject({ ok: true, rows: [{ table: 'obsidian.notes', ref: NOTE }] });
    expect(tables['core.dash_actions']).toEqual([
      expect.objectContaining({
        user_id: ME,
        surface: 'routine',
        kind: 'add_quick_note',
        status: 'done',
        subject_ref: `obsidian.notes:${NOTE}`,
        op: 'insert',
        undo: { vault_blob_sha: 'sha-1' },
      }),
    ]);
  });

  it('files an idea as the ideas page would, recorded for Undo', async () => {
    const { tables, context } = await shared();
    const result = await runConnectorWrite(tool('add_idea'), context, { text: 'Let Dash add a job from a link', module: 'jobs' });
    expect(result.ok).toBe(true);
    expect(tables['public.ideas']).toEqual([expect.objectContaining({ user_id: ME, body: 'Let Dash add a job from a link', module: 'jobs' })]);
    expect(tables['core.dash_actions']).toEqual([
      expect.objectContaining({ surface: 'routine', kind: 'add_idea', subject_ref: `public.ideas:${tables['public.ideas'][0].id}` }),
    ]);
  });

  it('refuses a workspace that is off, and records nothing', async () => {
    const { tables, context } = await shared({ enabledModules: ['dev'], today: '2026-10-13' });
    const result = await runConnectorWrite(tool('add_quick_note'), context, { text: 'A thought' });
    expect(result).toEqual({ ok: false, error: 'The Vault workspace is switched off, so nothing can be changed there.' });
    expect(tables['core.dash_actions']).toEqual([]);
  });

  it('is refused on a context with no service-role clients', async () => {
    expect(await runConnectorWrite(tool('add_job_lead'), ctx(), { url: 'https://example.com/jobs/1' })).toEqual({
      ok: false,
      error: 'That change cannot be made through this connection.',
    });
  });
});
