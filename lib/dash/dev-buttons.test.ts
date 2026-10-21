import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { DashWriteContext } from './registry';

/**
 * The Dev tools write the rows their buttons write (plan #2473.5): an idea
 * Dash files when asked, as the ideas page's box does, and a note a comment
 * files, as the notes page does. The button's own server action runs on one
 * copy of the person's rows, the tool on another, from the same input, and
 * the two copies are compared.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));

const ME = '00000000-0000-4000-8000-0000000000aa';
const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));

vi.mock('@/lib/auth/server', async (importOriginal) => {
  const { fakeSchemaDb: fake } = await import('../../tests/stubs/fake-schema-db');
  return {
    ...(await importOriginal<typeof import('@/lib/auth/server')>()),
    createClient: async () => fake(state.tables)('public'),
    requireUser: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
  };
});
vi.mock('@/lib/dev/owner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dev/owner')>()),
  requireOwner: async () => ({ id: '00000000-0000-4000-8000-0000000000aa' }),
}));

const ideas = await import('@/app/dev/ideas/actions');
const bugs = await import('@/app/dev/bugs/actions');
const { WRITE_TOOLS } = await import('./writes');
const { carryOut } = await import('@/lib/comments/act');

function twins(seed: FakeTables): [FakeTables, FakeTables] {
  return [structuredClone(seed), structuredClone(seed)];
}

/** The rows as the database holds them, less what each insert makes up for itself. */
function rows(tables: FakeTables, key: string): Record<string, unknown>[] {
  return (tables[key] ?? []).map((row) => {
    const rest = { ...row };
    delete rest.id;
    delete rest.created_at;
    return rest;
  });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('the Dev tools write what their buttons write', () => {
  it('add_idea files the idea as the ideas page box does', async () => {
    const [page, dash] = twins({ 'public.ideas': [] });
    state.tables = page;
    expect(await ideas.addIdea({}, form({ body: 'A search box across every workspace', module: 'dev' }))).toMatchObject({
      message: 'Idea saved.',
    });
    const db = fakeSchemaDb(dash);
    const ctx: DashWriteContext = {
      userId: ME,
      today: '2026-10-03',
      timezone: 'Europe/London',
      enabledModules: ['dev'],
      db: async (schema) => db(schema),
      searchSources: [],
      seen: () => true,
      goals: async () => db('goals') as unknown as GoalsSupabaseClient,
      createTask: async () => ({ id: null, error: 'unused' }),
    };
    const result = await WRITE_TOOLS.find((tool) => tool.name === 'add_idea')!.apply(ctx, {
      text: 'A search box across every workspace',
      module: 'dev',
    });
    expect(result.ok).toBe(true);
    expect(rows(dash, 'public.ideas')).toEqual(rows(page, 'public.ideas'));
  });

  it('file_note files the note on the queue as the notes page does', async () => {
    const [page, dash] = twins({ 'public.feedback_items': [] });
    state.tables = page;
    expect(
      await bugs.submitFeedback({}, form({ kind: 'bug', body: 'The shelf picker opens on the wrong shelf.', page_path: '/dev/plan' })),
    ).toMatchObject({ filed: { table: 'feedback_items' } });
    const outcome = await carryOut({
      supabase: fakeSchemaDb(dash)('public') as never,
      userId: ME,
      target: 'step',
      id: '11111111-1111-4111-8111-111111111111',
      action: { name: 'file_note', text: 'The shelf picker opens on the wrong shelf.', kind: 'bug', module: null, field: null, detail: null },
      dash: fakeDashDeps(dash, ME),
    });
    expect(outcome.ok).toBe(true);
    expect(rows(dash, 'public.feedback_items')).toEqual(rows(page, 'public.feedback_items'));
  });
});
