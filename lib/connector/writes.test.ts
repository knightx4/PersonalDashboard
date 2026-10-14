import { describe, expect, it, vi } from 'vitest';
import { VAULT_CHANGE_KINDS } from '@/lib/ask/vault-changes';
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
  it('offers the Learn writes, then the quick note, the idea and the job lead, then Goals, then the rest of Learn, then Todo', () => {
    expect(CONNECTOR_WRITE_TOOLS.map((entry) => entry.definition.name)).toEqual([
      'add_to_reading_list',
      'log_learning',
      'mark_read',
      'add_quick_note',
      'add_idea',
      'add_job_lead',
      'add_goal',
      'add_goal_step',
      'close_goal_step',
      'set_goal_done_when',
      'change_items',
      'change_reading',
      'add_learn_track',
      'add_track_reading',
      'reword_concept',
      'add_concept_note',
      'change_video',
      'edit_todo',
      'add_todo_item',
      'link_todo',
      'add_event',
      'change_event',
      'change_agenda_row',
      'add_place',
      'change_place',
      'save_job',
      'mark_issue_unread',
      'save_story',
      'send_story_to_learn',
      'make_todo_from_story',
      'stop_watch',
      'change_goal_area',
      'change_goal',
      'change_goal_step',
      'change_goal_number',
      'change_goal_link',
      'change_goal_form',
      'change_goals_inbox',
      'change_item',
      'item_lists',
      'add_items',
      'change_saved_item',
      'add_order',
      'order_item_tags',
      'review_orders',
      ...VAULT_CHANGE_KINDS,
      'change_role',
      'change_application',
      'change_company',
      'merge_roles',
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
    ['change_reading', { reading_id: 'not-an-id' }, "reading_id must be a reading's id, as a lookup returned it."],
    ['add_learn_track', {}, 'title is missing: name the reading list.'],
    ['change_video', { video_id: 'short' }, 'video_id must be the YouTube video id, eleven characters, as a lookup returned it.'],
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

  it('changes a todo on the service-role todo client, for the verified person only (plan #1894.9.1)', async () => {
    const TASK = '00000000-0000-4000-8000-000000000e01';
    const { tables, context } = await shared({ enabledModules: ['todo'], today: '2026-10-13' });
    tables['todo.tasks'] = [{ id: TASK, user_id: ME, title: 'Book the dentist', status: 'open', pinned: false }];
    const result = await runConnectorWrite(tool('edit_todo'), context, { todo_ref: TASK, pinned: true });
    expect(result).toMatchObject({ ok: true, rows: [{ table: 'todo.tasks', ref: TASK }] });
    expect(tables['todo.tasks'][0]).toMatchObject({ pinned: true });

    tables['todo.tasks'][0].user_id = 'someone else';
    expect(await runConnectorWrite(tool('edit_todo'), context, { todo_ref: TASK, pinned: false })).toEqual({
      ok: false,
      error: 'There is no todo of theirs with that ref. Look it up first.',
    });
  });

  it('refuses a Todo change when Todo is off', async () => {
    const { context } = await shared({ enabledModules: ['dev'], today: '2026-10-13' });
    expect(await runConnectorWrite(tool('add_event'), context, { title: 'Lunch', start_day: '2026-10-16', all_day: true })).toEqual({
      ok: false,
      error: 'The Todo workspace is switched off, so nothing can be changed there.',
    });
  });

  describe('goals (plan #1894.3)', () => {
    const AREA = '00000000-0000-4000-8000-000000000f01';
    const GOAL = '00000000-0000-4000-8000-000000000f02';
    const STEP = '00000000-0000-4000-8000-000000000f03';

    async function withGoals() {
      const made = await shared({ enabledModules: ['goals'], today: '2026-10-14' });
      const { fakeSchemaDb } = await import('../../tests/stubs/fake-schema-db');
      const actors: (string | undefined)[] = [];
      made.tables['goals.areas'] = [{ id: AREA, user_id: ME, name: 'Health', position: 1, archived_at: null }];
      made.tables['goals.items'] = [
        {
          id: GOAL,
          user_id: ME,
          level: 'goal',
          parent_id: null,
          area_id: AREA,
          title: 'Run a half marathon',
          status: 'open',
          acceptance: null,
          approved_at: '2026-10-01T00:00:00Z',
          archived_at: null,
          position: 1,
        },
        {
          id: STEP,
          user_id: ME,
          level: 'step',
          kind: 'mine',
          parent_id: GOAL,
          title: 'Buy running shoes',
          status: 'open',
          archived_at: null,
          position: 1,
        },
      ];
      const client = fakeSchemaDb(made.tables);
      made.context.db = async (schema) => client(schema);
      made.context.core = client('core');
      made.context.goals = async (history) => {
        actors.push(history.actor);
        return client('goals') as never;
      };
      return { ...made, actors };
    }

    it("sets a goal's done-when and records it for Undo", async () => {
      const { tables, context } = await withGoals();
      const result = await runConnectorWrite(tool('set_goal_done_when'), context, {
        goal_ref: GOAL,
        done_when: 'I finish a half marathon under two hours',
      });
      expect(result).toMatchObject({ ok: true, rows: [{ table: 'goals.items', ref: GOAL }] });
      expect(tables['goals.items'][0]).toMatchObject({ acceptance: 'I finish a half marathon under two hours' });
      expect(tables['core.dash_actions']).toEqual([
        expect.objectContaining({ surface: 'routine', kind: 'set_goal_done_when', subject_ref: `goals.items:${GOAL}`, op: 'update' }),
      ]);
    });

    it('adds a step under a goal and closes a step, as Dash', async () => {
      const { tables, context, actors } = await withGoals();
      const added = await runConnectorWrite(tool('add_goal_step'), context, { goal_ref: GOAL, title: 'Run 10k' });
      expect(added).toMatchObject({ ok: true, rows: [{ table: 'goals.items' }] });
      expect(tables['goals.items'].find((row) => row.title === 'Run 10k')).toMatchObject({ parent_id: GOAL, level: 'step', user_id: ME });

      const closed = await runConnectorWrite(tool('close_goal_step'), context, { step_ref: STEP });
      expect(closed).toMatchObject({ ok: true, rows: [{ table: 'goals.items', ref: STEP }] });
      expect(tables['goals.items'].find((row) => row.id === STEP)).toMatchObject({ status: 'done' });
      expect(actors).toEqual(['claude', 'claude']);
      expect(tables['core.dash_actions'].map((row) => row.kind)).toEqual(['add_goal_step', 'close_goal_step']);
    });

    it("refuses another person's goal", async () => {
      const { tables, context } = await withGoals();
      tables['goals.items'][0].user_id = 'someone else';
      const result = await runConnectorWrite(tool('set_goal_done_when'), context, { goal_ref: GOAL, done_when: 'Done' });
      expect(result).toEqual({ ok: false, error: 'That goal is not one of theirs, or it has been archived.' });
      expect(tables['core.dash_actions']).toEqual([]);
    });

    it('refuses when Goals is off', async () => {
      const { context } = await withGoals();
      context.account = { enabledModules: ['dev'], today: '2026-10-14' };
      expect(await runConnectorWrite(tool('close_goal_step'), context, { step_ref: STEP })).toEqual({
        ok: false,
        error: 'The Goals workspace is switched off, so nothing can be changed there.',
      });
    });
  });

  it('is refused on a context with no service-role clients', async () => {
    expect(await runConnectorWrite(tool('add_job_lead'), ctx(), { url: 'https://example.com/jobs/1' })).toEqual({
      ok: false,
      error: 'That change cannot be made through this connection.',
    });
  });
});
