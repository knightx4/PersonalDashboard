import { describe, expect, it, vi } from 'vitest';
import { undoDashAction } from '@/lib/core/dash-actions';
import type { SchemaClient } from '@/lib/ask/db';
import { fakeDashDeps, fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { carryOut, type ActInput } from './act';
import type { DashAction } from './reply-payload';

/**
 * Every row a dev comment action writes leaves a core.dash_actions row that
 * puts it back (plan #1459), run against one in-memory database standing in
 * for the person's clients.
 */

vi.mock('@/lib/plan/handover', () => ({
  handStepToClaude: vi.fn(async () => ({ ok: false, error: 'A session is already on this feature.' })),
}));

const ME = '00000000-0000-4000-8000-0000000000aa';
const STEP = '00000000-0000-4000-8000-000000000101';
const IDEA = '00000000-0000-4000-8000-000000000102';

function setup(tables: FakeTables = {}) {
  tables['public.plan_items'] ??= [
    { id: STEP, user_id: ME, module: 'dev', parent_id: null, title: 'A step', detail: null, acceptance: null, status: 'not_started', position: 10, updated_at: '2026-10-01T09:00:00Z' },
  ];
  tables['public.ideas'] ??= [
    { id: IDEA, user_id: ME, body: 'An idea as written', module: null, source: 'me', updated_at: '2026-10-01T09:00:00Z' },
  ];
  const dash = fakeDashDeps(tables, ME);
  const supabase = fakeSchemaDb(tables)('public') as SchemaClient as ActInput['supabase'];
  const act = ({ action, ...over }: Partial<Omit<ActInput, 'action'>> & { action: Partial<DashAction> & { name: string } }) =>
    carryOut({
      supabase,
      userId: ME,
      target: 'step',
      id: STEP,
      dash,
      ...over,
      action: { text: null, module: null, field: null, detail: null, kind: null, ...action },
    });
  const actions = () => tables['core.dash_actions'] ?? [];
  return { tables, dash, act, actions };
}

describe('dev comment actions record what they write', () => {
  it('records a filed idea, and undoing it takes the idea away', async () => {
    const { tables, dash, act, actions } = setup();
    const outcome = await act({ action: { name: 'file_idea', text: 'File notes from a shortcut.' } });
    expect(outcome.ok).toBe(true);

    const filed = tables['public.ideas'].find((r) => r.body === 'File notes from a shortcut.')!;
    expect(actions()).toHaveLength(1);
    expect(actions()[0]).toMatchObject({
      user_id: ME,
      surface: 'thread',
      kind: 'file_idea',
      status: 'done',
      op: 'insert',
      subject_ref: `public.ideas:${filed.id}`,
      before_values: null,
      summary: 'Filed an idea: File notes from a shortcut.',
    });
    expect(actions()[0].after_values).toMatchObject({ body: 'File notes from a shortcut.' });

    const undone = await undoDashAction(dash, actions()[0].id as string);
    expect(undone.ok).toBe(true);
    expect(tables['public.ideas'].some((r) => r.id === filed.id)).toBe(false);
  });

  it('records a filed note, and undoing it takes the note away', async () => {
    const { tables, dash, act, actions } = setup();
    await act({ action: { name: 'file_note', text: 'The button does nothing.' } });
    const note = tables['public.feedback_items'][0];
    expect(actions()[0]).toMatchObject({ kind: 'file_note', subject_ref: `public.feedback_items:${note.id}` });

    expect((await undoDashAction(dash, actions()[0].id as string)).ok).toBe(true);
    expect(tables['public.feedback_items']).toHaveLength(0);
  });

  it('records a proposed step, and will not take it back once something hangs off it', async () => {
    const { tables, dash, act, actions } = setup();
    await act({ action: { name: 'add_step', text: 'A step beneath' } });
    const added = tables['public.plan_items'].find((r) => r.title === 'A step beneath')!;
    expect(actions()[0]).toMatchObject({ kind: 'add_step', op: 'insert', subject_ref: `public.plan_items:${added.id}` });

    tables['public.dev_comments'] = [{ id: 'c1', user_id: ME, plan_item_id: added.id, body: 'Do this one first.' }];
    const refused = await undoDashAction(dash, actions()[0].id as string);
    expect(refused).toMatchObject({ ok: false, error: 'Something has been added to it since, so undoing would lose that too.' });
    expect(tables['public.plan_items'].some((r) => r.id === added.id)).toBe(true);

    tables['public.dev_comments'] = [];
    expect((await undoDashAction(dash, actions()[0].id as string)).ok).toBe(true);
    expect(tables['public.plan_items'].some((r) => r.id === added.id)).toBe(false);
  });

  it('records a step written to be built as it was before the hand-over', async () => {
    const { tables, act, actions } = setup();
    await act({ target: 'raise', id: 'raise-1', action: { name: 'build_step', text: 'Build it now' } });
    const added = tables['public.plan_items'].find((r) => r.title === 'Build it now')!;
    expect(actions()[0]).toMatchObject({ kind: 'build_step', op: 'insert', subject_ref: `public.plan_items:${added.id}` });
    expect(actions()[0].after_values).toMatchObject({ status: 'not_started' });
  });

  it('records a reworded idea with what it said, and undoing it puts the words back', async () => {
    const { tables, dash, act, actions } = setup();
    await act({ target: 'idea', id: IDEA, action: { name: 'reword', text: 'An idea reworded' } });
    expect(tables['public.ideas'][0].body).toBe('An idea reworded');
    expect(actions()[0]).toMatchObject({
      kind: 'reword',
      op: 'update',
      subject_ref: `public.ideas:${IDEA}`,
      before_values: { body: 'An idea as written' },
      after_values: { body: 'An idea reworded' },
    });

    expect((await undoDashAction(dash, actions()[0].id as string)).ok).toBe(true);
    expect(tables['public.ideas'][0].body).toBe('An idea as written');
  });

  it('records a reworded done-when, and refuses to put it back once it was edited again', async () => {
    const { tables, dash, act, actions } = setup();
    await act({ action: { name: 'reword', field: 'done-when', text: 'It works.' } });
    expect(actions()[0]).toMatchObject({ kind: 'reword', before_values: { acceptance: null }, after_values: { acceptance: 'It works.' } });

    tables['public.plan_items'][0].acceptance = 'It works, and is tested.';
    const refused = await undoDashAction(dash, actions()[0].id as string);
    expect(refused.ok).toBe(false);
    expect(tables['public.plan_items'][0].acceptance).toBe('It works, and is tested.');
  });

  it('records nothing when the action writes nothing', async () => {
    const { act, actions } = setup();
    await act({ action: { name: 'file_idea' } });
    expect(actions()).toHaveLength(0);
  });
});
