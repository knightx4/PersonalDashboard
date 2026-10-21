import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { fakeVaultNotes } from '../../tests/stubs/fake-vault-notes';
import type { DashWriteContext } from './registry';

/**
 * Each Vault tool writes the rows its button writes (plan #2473.5): a new
 * note and a quick note in the Inbox, a theme renamed, and the question of a
 * thread with Maya rewritten. The button's own server action runs on one copy
 * of the person's rows, the tool on another, from the same input, and the two
 * copies are compared. The vault's repository is the in-memory one in
 * tests/stubs/fake-vault-notes.ts, behind the ports both sides write through.
 */

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));

const ME = '00000000-0000-4000-8000-0000000000aa';
const THEM = '00000000-0000-4000-8000-0000000000bb';
const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));

vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));
vi.mock('@/lib/vault/auth/server', async () => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return { createVaultClient: async () => fake(state.tables)('obsidian') };
});
vi.mock('@/lib/core/auth/server', async () => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return { createCoreClient: async () => fake(state.tables)('core') };
});
// The page's note ports, over the same in-memory vault as the tool's.
vi.mock('@/lib/vault/db/ports', async (importOriginal) => {
  const { fakeVaultNotes: fake } = await import('../../tests/stubs/fake-vault-notes');
  return {
    ...(await importOriginal<typeof import('@/lib/vault/db/ports')>()),
    noteCreatePorts: () => fake((state.tables['obsidian.notes'] ??= []), '00000000-0000-4000-8000-0000000000aa').ports.create,
  };
});

const vaultPage = await import('@/app/vault/actions');
const mapPage = await import('@/app/vault/map/actions');
const mayaPage = await import('@/app/vault/maya/actions');
const { VAULT_WRITES, runVaultWrite } = await import('./vault-writes');
const { WRITE_TOOLS } = await import('./writes');

const THEME = '33333333-3333-4333-8333-333333333333';
const THEIR_THEME = '33333333-3333-4333-8333-333333333334';
const THREAD = '44444444-4444-4444-8444-444444444444';

function twins(seed: FakeTables): [FakeTables, FakeTables] {
  return [structuredClone(seed), structuredClone(seed)];
}

async function press<T>(tables: FakeTables, act: () => Promise<T>): Promise<T> {
  state.tables = tables;
  return act();
}

async function vaultTool(name: string, tables: FakeTables, input: Record<string, unknown>) {
  const db = fakeSchemaDb(tables);
  const notes = fakeVaultNotes((tables['obsidian.notes'] ??= []), ME).ports;
  const made = await runVaultWrite(
    VAULT_WRITES.find((entry) => entry.name === name)!,
    { userId: ME, vault: db('obsidian'), core: db('core'), you: db('you'), notes },
    input,
  );
  if ('ok' in made) throw new Error(made.error);
  return made;
}

describe('the Vault tools write what their buttons write', () => {
  it('write_vault_note writes the note in the Inbox as New note does', async () => {
    const [page, dash] = twins({ 'obsidian.notes': [] });
    await press(page, () => vaultPage.newVaultNote({ error: null }, (() => {
      const data = new FormData();
      data.set('title', 'Boiler');
      data.set('body', 'Book the service in March.');
      return data;
    })()));
    await vaultTool('write_vault_note', dash, { title: 'Boiler', body: 'Book the service in March.' });
    expect(dash['obsidian.notes']).toEqual(page['obsidian.notes']);
    expect(dash['obsidian.notes'][0]).toMatchObject({ path: 'Inbox/Boiler.md' });
  });

  it('add_quick_note files the thought as the Vault page quick note does', async () => {
    const [page, dash] = twins({ 'obsidian.notes': [] });
    expect(await press(page, () => vaultPage.addQuickNote('Call Ana about the lease'))).toEqual({ error: null });
    const db = fakeSchemaDb(dash);
    const ctx: DashWriteContext = {
      userId: ME,
      today: '2026-10-03',
      timezone: 'Europe/London',
      enabledModules: ['vault'],
      db: async (schema) => db(schema),
      searchSources: [],
      seen: () => true,
      goals: async () => db('goals') as unknown as GoalsSupabaseClient,
      createTask: async () => ({ id: null, error: 'unused' }),
      quickNotePorts: async () => fakeVaultNotes(dash['obsidian.notes'], ME).ports.create,
    };
    const result = await WRITE_TOOLS.find((tool) => tool.name === 'add_quick_note')!.apply(ctx, { text: 'Call Ana about the lease' });
    expect(result.ok).toBe(true);
    expect(dash['obsidian.notes']).toEqual(page['obsidian.notes']);
    expect(dash['obsidian.notes']).toHaveLength(1);
  });

  it('rename_theme renames the theme as the map does, and leaves another account alone', async () => {
    const theme = (id: string, user: string) => ({ id, user_id: user, name: 'Home', about: null });
    const [page, dash] = twins({ 'obsidian.themes': [theme(THEME, ME), theme(THEIR_THEME, THEM)] });
    expect(await press(page, () => mapPage.renameTheme(THEME, '  The flat  '))).toEqual({ error: null });
    await vaultTool('rename_theme', dash, { theme_ref: THEME, name: 'The flat' });
    expect(dash['obsidian.themes']).toEqual(page['obsidian.themes']);
    expect(dash['obsidian.themes'].map((t) => t.name)).toEqual(['The flat', 'Home']);
  });

  it('rename_maya_question rewrites the question as the thread page does', async () => {
    const [page, dash] = twins({
      'core.conversations': [{ id: THREAD, user_id: ME, title: 'What is the flat costing me?', subject_ref: null, voice: 'maya' }],
    });
    expect(await press(page, () => mayaPage.renameMayaQuestion(THREAD, '  What does the flat   cost a year? '))).toEqual({});
    await vaultTool('rename_maya_question', dash, { thread_ref: THREAD, question: 'What does the flat cost a year?' });
    expect(dash['core.conversations']).toEqual(page['core.conversations']);
    expect(dash['core.conversations'][0].title).toBe('What does the flat cost a year?');
  });
});
