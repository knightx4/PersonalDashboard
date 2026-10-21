import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { DashWriteContext } from './registry';

/**
 * The Dev tools write the rows their buttons write (plan #2473.5): an idea
 * Dash files when asked, as the ideas page's box does, and a note a comment
 * files, as the notes page does. A comment's reword leaves an idea, a note,
 * a step and a feature as their Edit buttons do (plan #2473.9). The button's own server action runs on one
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
const plan = await import('@/app/dev/plan/actions');
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

const ROW = '22222222-2222-4222-8222-222222222222';
const FEATURE = '33333333-3333-4333-8333-333333333333';

/** A comment's reword of the row it is on, run against one copy of the rows. */
function reword(tables: FakeTables, target: 'idea' | 'note' | 'step', id: string, text: string, field: string | null = null) {
  return carryOut({
    supabase: fakeSchemaDb(tables)('public') as never,
    userId: ME,
    target,
    id,
    action: { name: 'reword', text, kind: null, module: null, field, detail: null },
    dash: fakeDashDeps(tables, ME),
  });
}

describe('reword leaves the rows its Edit buttons leave', () => {
  it('rewrites an idea as the ideas page Edit does', async () => {
    const [page, dash] = twins({
      'public.ideas': [{ id: ROW, user_id: ME, body: 'Receipts by photo.', module: 'dev', dismissed_at: null }],
    });
    state.tables = page;
    expect(await ideas.updateIdea({}, form({ id: ROW, body: 'File a receipt from a photo of it.', module: 'dev' }))).toMatchObject({
      message: 'Saved.',
    });
    expect((await reword(dash, 'idea', ROW, 'File a receipt from a photo of it.')).ok).toBe(true);
    expect(dash['public.ideas']).toEqual(page['public.ideas']);
  });

  it('rewrites an open note as the notes page Edit does', async () => {
    const [page, dash] = twins({
      'public.feedback_items': [{ id: ROW, user_id: ME, kind: 'bug', body: 'The picker is broken.', status: 'open' }],
    });
    state.tables = page;
    expect(
      await bugs.editFeedback({}, form({ id: ROW, kind: 'bug', body: 'The shelf picker opens on the wrong shelf.' })),
    ).toMatchObject({ message: 'Saved.' });
    expect((await reword(dash, 'note', ROW, 'The shelf picker opens on the wrong shelf.')).ok).toBe(true);
    expect(dash['public.feedback_items']).toEqual(page['public.feedback_items']);
  });

  it('refuses a closed note, as the notes page Edit does', async () => {
    const seed = { 'public.feedback_items': [{ id: ROW, user_id: ME, kind: 'bug', body: 'Fixed already.', status: 'done' }] };
    const [page, dash] = twins(seed);
    state.tables = page;
    expect(await bugs.editFeedback({}, form({ id: ROW, kind: 'bug', body: 'Something else.' }))).toMatchObject({
      error: expect.stringContaining('already closed'),
    });
    const outcome = await reword(dash, 'note', ROW, 'Something else.');
    expect(outcome.ok === false && outcome.why).toContain('already closed');
    expect(dash['public.feedback_items']).toEqual(seed['public.feedback_items']);
    expect(page['public.feedback_items']).toEqual(seed['public.feedback_items']);
  });

  const feature = {
    id: FEATURE,
    user_id: ME,
    parent_id: null,
    module: 'dev',
    title: 'Quick notes',
    summary: 'Notes in one press.',
    detail: 'The box.',
    acceptance: 'It saves.',
    priority: 2,
    size: 'm',
    assignee: null,
    status: 'not_started',
    comment: null,
    commit_sha: null,
    block_kind: null,
    block_ask: null,
    position: 10,
  };
  const step = { ...feature, id: ROW, parent_id: FEATURE, title: 'Draw the box', summary: null, detail: 'A text box.', acceptance: 'It shows.', size: 's' };

  it("rewrites a step's done-when as the step form does", async () => {
    const [page, dash] = twins({ 'public.plan_items': [feature, step] });
    state.tables = page;
    const saved = await plan.updatePlanItem(
      {},
      form({
        id: ROW,
        parent: FEATURE,
        title: step.title,
        detail: step.detail,
        acceptance: 'It shows under the header.',
        comment: '',
        commit: '',
        status: 'not_started',
        priority: '2',
        size: 's',
        assignee: '',
      }),
    );
    expect(saved).toMatchObject({ message: 'Saved.' });
    expect((await reword(dash, 'step', ROW, 'It shows under the header.', 'done_when')).ok).toBe(true);
    expect(dash['public.plan_items']).toEqual(page['public.plan_items']);
  });

  it("rewrites a feature's title as its compose surface does", async () => {
    const [page, dash] = twins({ 'public.plan_items': [feature, step] });
    state.tables = page;
    const saved = await plan.updateFeature(
      {},
      form({
        id: FEATURE,
        title: 'Quick notes in the vault',
        summary: feature.summary,
        detail: feature.detail,
        acceptance: feature.acceptance,
        priority: '2',
        size: 'm',
        assignee: '',
      }),
    );
    expect(saved).toMatchObject({ message: 'Saved.' });
    expect((await reword(dash, 'step', FEATURE, 'Quick notes in the vault', 'title')).ok).toBe(true);
    expect(dash['public.plan_items']).toEqual(page['public.plan_items']);
  });
});
