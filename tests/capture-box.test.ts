import { describe, expect, it, vi } from 'vitest';
import { fileCaptureParts, goalRefs, makeCaptureKind, type CaptureWriters } from '@/lib/capture/file';
import type { CapturePart } from '@/lib/capture/sort';
import { markDashActionUndone, recordDashAction, undoDashAction, undoneByVault } from '@/lib/core/dash-actions';
import { writeRoleNote } from '@/lib/dash/writes';
import type { FiledEntry } from '@/lib/goals/capture';
import { dashTodayEntry, undoDashTodayWith } from '@/lib/shell/dash-today';
import { createCapturedNote, removeCapturedNote, type RemoveNotePorts } from '@/lib/vault/notes/create';
import type { VaultSource } from '@/lib/vault/providers/types';
import { fakeDashDeps, fakeId, type FakeTables } from './stubs/fake-schema-db';

/**
 * The one capture box (plan #1581): a todo, a goal update and a job note
 * typed into it each land through their workspace's own writer, the box
 * names where each went, and a todo or a note is recorded as capture's in
 * core.dash_actions so Undo, from the box or from Home, takes it back.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const ROLE = { id: '00000000-0000-4000-8000-000000000002', title: 'Product Analyst', company: 'Stripe' };
const CAPTURE = '00000000-0000-4000-8000-000000000003';

const GOAL_LINE: FiledEntry = {
  kind: 'close',
  step_id: '00000000-0000-4000-8000-000000000004',
  title: 'Run 10k',
  goal_title: 'Run a half marathon',
  undone_at: null,
};

function setup() {
  const tables: FakeTables = {
    'todo.tasks': [],
    'job_search.roles': [{ id: ROLE.id, user_id: ME, title: ROLE.title }],
    'core.dash_actions': [],
    'obsidian.notes': [],
    'goals.items': [],
    'goals.areas': [],
    'public.plan_items': [],
    'public.ideas': [],
    'public.feedback_items': [],
  };
  /** A writer that puts one row in a fake table and hands back its id. */
  const into = (table: string, row: Record<string, unknown>) => {
    const id = fakeId();
    tables[table].push({ id, user_id: ME, ...row });
    return { ok: true as const, id };
  };
  /** The notes repository: path to blob SHA, and each commit made. */
  const repo = new Map<string, string>();
  const commits: string[] = [];
  const source = {
    async createNote(path: string, _text: string, message: string) {
      if (repo.has(path)) throw new Error('exists');
      const blobSha = `blob-${repo.size + 1}`;
      repo.set(path, blobSha);
      commits.push(message);
      return { blobSha, commitSha: `commit-${commits.length}` };
    },
    async deleteNote(path: string, _sha: string, message: string) {
      repo.delete(path);
      commits.push(message);
      return `commit-${commits.length}`;
    },
  } as unknown as VaultSource;
  const notes = tables['obsidian.notes'];
  const removePorts: RemoveNotePorts = {
    openSource: async () => source,
    loadNote: async (id) => {
      const row = notes.find((note) => note.id === id);
      return row
        ? { id, path: String(row.path), title: String(row.title), blobSha: String(row.blob_sha), deleted: row.deleted_at !== null }
        : null;
    },
    markDeleted: async (id) => {
      const row = notes.find((note) => note.id === id);
      if (row) row.deleted_at = '2026-10-04T10:00:00Z';
    },
  };
  const dash = fakeDashDeps(tables, ME);
  const goals = vi.fn(async () => ({ captureId: CAPTURE, filed: [GOAL_LINE] }));
  const writers: CaptureWriters = {
    todo: async (text) => {
      const id = fakeId();
      tables['todo.tasks'].push({ id, user_id: ME, title: text, status: 'open' });
      return { id };
    },
    goals,
    jobs: async (roleId, text) => {
      const written = await writeRoleNote({ userId: ME, enabledModules: ['jobs'], db: dash.db }, roleId, text);
      return written.ok ? { ok: true, subjectRef: written.subjectRef } : { ok: false, error: written.error };
    },
    vault: async (text) => {
      const result = await createCapturedNote(
        {
          openSource: async () => source,
          storeNote: async (row) => {
            const id = fakeId();
            notes.push({ id, user_id: ME, path: row.path, title: row.title, body: row.body, blob_sha: row.blobSha, deleted_at: null });
            return id;
          },
          afterSave: () => {},
        },
        text,
      );
      return result.ok ? result : { ok: false, error: result.error };
    },
    goal: async (areaId, title) => into('goals.items', { area_id: areaId, title }),
    goalArea: async (name) => into('goals.areas', { name }),
    planItem: async (title, at) => into('public.plan_items', { title, module: at.scope, parent_id: at.parentId }),
    idea: async (body) => into('public.ideas', { body, module: null }),
    devNote: async (body, pagePath) => into('public.feedback_items', { body, page_path: pagePath, kind: 'feature' }),
    record: (entry) => recordDashAction(dash, entry),
  };
  return { tables, dash, writers, goals, repo, commits, removePorts };
}

const parts: CapturePart[] = [
  { place: 'todo', text: 'call the dentist', goal: null, role: null },
  { place: 'goals', text: 'ran 10k this morning', goal: { id: fakeId(), title: 'Run a half marathon' }, role: null },
  { place: 'jobs', text: 'Recruiter is Sam', goal: null, role: ROLE },
];

describe('filing from the one capture box', () => {
  it('lands each part in its workspace and names where it went', async () => {
    const world = setup();
    const { filed, errors } = await fileCaptureParts(parts, world.writers);

    expect(errors).toEqual([]);
    expect(filed.map((item) => item.where)).toEqual([
      'Todo · Today',
      'Goals · Run a half marathon',
      'Job search · Product Analyst at Stripe',
    ]);
    expect(world.tables['todo.tasks']).toMatchObject([{ title: 'call the dentist' }]);
    expect(world.goals).toHaveBeenCalledWith('ran 10k this morning');
    expect(filed[1].goals).toEqual({ captureId: CAPTURE, entries: [GOAL_LINE] });
    expect(world.tables['core.conversation_turns']).toMatchObject([
      { ref: `job_search.roles:${ROLE.id}`, author: 'me', body: 'Recruiter is Sam' },
    ]);
  });

  it('records the todo and the note as capture’s, and leaves the goal lines to Goals', async () => {
    const world = setup();
    const { filed } = await fileCaptureParts(parts, world.writers);

    expect(world.tables['core.dash_actions']).toMatchObject([
      { surface: 'capture', kind: 'add_todo', op: 'insert', status: 'done' },
      { surface: 'capture', kind: 'add_role_note', op: 'insert', status: 'done' },
    ]);
    expect(filed[0].actionId).toBe(world.tables['core.dash_actions'][0].id);
    expect(filed[1].actionId).toBeNull();
    expect(filed[2].actionId).toBe(world.tables['core.dash_actions'][1].id);
  });

  it('undoes a todo and a note from the box by the generic rule', async () => {
    const world = setup();
    const { filed } = await fileCaptureParts(parts, world.writers);

    const todo = await undoDashAction(world.dash, filed[0].actionId!);
    const note = await undoDashAction(world.dash, filed[2].actionId!);
    expect(todo.ok).toBe(true);
    expect(note.ok).toBe(true);
    expect(world.tables['todo.tasks']).toEqual([]);
    expect(world.tables['core.conversation_turns']).toEqual([]);
    expect(world.tables['core.dash_actions'].map((row) => row.status)).toEqual(['undone', 'undone']);
  });

  it('undoes a todo from Home without handing it to Goals’ capture undo', async () => {
    const world = setup();
    const { filed } = await fileCaptureParts(parts.slice(0, 1), world.writers);
    const undoCapture = vi.fn();

    const out = await undoDashTodayWith(world.dash, filed[0].actionId!, vi.fn(), undefined, undoCapture);
    expect(out.ok).toBe(true);
    expect(undoCapture).not.toHaveBeenCalled();
    expect(world.tables['todo.tasks']).toEqual([]);
  });

  it('writes a vault note into the Inbox, in the repository and in the app, and Undo takes it out of both', async () => {
    const world = setup();
    const { filed, errors } = await fileCaptureParts(
      [{ place: 'vault', text: 'Idea: a book about tide pools\nwith photos', goal: null, role: null }],
      world.writers,
    );

    expect(errors).toEqual([]);
    expect(filed[0]).toMatchObject({ place: 'vault', where: 'Vault · Inbox', href: '/vault' });
    expect([...world.repo.keys()]).toEqual(['Inbox/Idea a book about tide pools.md']);
    expect(world.tables['obsidian.notes']).toMatchObject([
      { path: 'Inbox/Idea a book about tide pools.md', title: 'Idea a book about tide pools', blob_sha: 'blob-1', deleted_at: null },
    ]);
    const [action] = world.tables['core.dash_actions'];
    expect(action).toMatchObject({ surface: 'capture', kind: 'add_vault_note', undo: { vault_blob_sha: 'blob-1' } });
    expect(filed[0].actionId).toBe(action.id);

    // The generic rule would only delete the row, so it leaves the note to capture.
    const generic = await undoDashAction(world.dash, action.id as string);
    expect(generic.ok).toBe(false);
    expect(generic.action && undoneByVault(generic.action)).toBe(true);
    expect(world.repo.size).toBe(1);

    // Home hands it to capture's own undo, as app/home/actions.ts does.
    const out = await undoDashTodayWith(world.dash, action.id as string, vi.fn(), undefined, async (found) => {
      const removed = await removeCapturedNote(world.removePorts, found.subjectRef!.split(':')[1], String(found.undo!.vault_blob_sha));
      if (!removed.ok) return removed;
      await markDashActionUndone(world.dash, found.id);
      return { ok: true, paths: ['/vault'] };
    });
    expect(out.ok).toBe(true);
    expect(world.repo.size).toBe(0);
    expect(world.commits).toEqual(['Add Idea a book about tide pools from Dash', 'Remove Idea a book about tide pools from Dash']);
    expect(world.tables['obsidian.notes'][0].deleted_at).not.toBeNull();
    expect(world.tables['core.dash_actions'][0].status).toBe('undone');
  });

  it('says why a job note with no role was not filed, and files the rest', async () => {
    const world = setup();
    const { filed, errors } = await fileCaptureParts(
      [parts[0], { place: 'jobs', text: 'they called', goal: null, role: null }],
      world.writers,
    );
    expect(filed.map((item) => item.place)).toEqual(['todo']);
    expect(errors).toEqual(['Dash could not tell which job this is about. Name the company and try again.']);
  });

  it('refuses a role that is not theirs, writing nothing', async () => {
    const world = setup();
    const { filed, errors } = await fileCaptureParts(
      [{ place: 'jobs', text: 'note', goal: null, role: { ...ROLE, id: fakeId() } }],
      world.writers,
    );
    expect(filed).toEqual([]);
    expect(errors[0]).toMatch(/not one of theirs/);
    expect(world.tables['core.dash_actions']).toEqual([]);
  });
});

describe('files sent with a capture (plan #1714)', () => {
  it('puts the files on every row a split capture filed, and counts them on each line', async () => {
    const world = setup();
    const attach = vi.fn<(ref: string) => Promise<number>>(async () => 2);
    const { filed, errors } = await fileCaptureParts(parts, { ...world.writers, attach });

    expect(errors).toEqual([]);
    const todoId = world.tables['todo.tasks'][0].id;
    // A role note is a turn of the role's thread, so its files go on the turn.
    const noteId = world.tables['core.conversation_turns'][0].id;
    expect(attach.mock.calls.map(([ref]) => ref)).toEqual([
      `todo.tasks:${todoId}`,
      `goals.items:${GOAL_LINE.step_id}`,
      `core.conversation_turns:${noteId}`,
    ]);
    expect(filed.map((item) => item.files)).toEqual([2, 2, 2]);
  });

  it('files the todo even when its files cannot be kept, and says so', async () => {
    const world = setup();
    const attach = vi.fn(async () => {
      throw new Error('a sixth file');
    });
    const { filed, errors } = await fileCaptureParts(parts.slice(0, 1), { ...world.writers, attach });

    expect(filed).toHaveLength(1);
    expect(filed[0].files).toBeUndefined();
    expect(world.tables['todo.tasks']).toHaveLength(1);
    expect(errors).toEqual(['It was filed, but the files could not be kept with it.']);
  });

  it('records nothing and counts nothing when no files were sent', async () => {
    const world = setup();
    const { filed } = await fileCaptureParts(parts.slice(0, 1), world.writers);
    expect(filed[0].files).toBeUndefined();
  });

  it('takes the files away with the todo on Undo', async () => {
    const world = setup();
    const forget = vi.fn(async () => {});
    const { filed } = await fileCaptureParts(parts.slice(0, 1), { ...world.writers, attach: async () => 1 });
    const todoId = world.tables['todo.tasks'][0].id;

    const out = await undoDashTodayWith({ ...world.dash, forget }, filed[0].actionId!, vi.fn());
    expect(out.ok).toBe(true);
    expect(world.tables['todo.tasks']).toEqual([]);
    expect(forget).toHaveBeenCalledWith(`todo.tasks:${todoId}`);
  });

  it('keeps the undo when forgetting the files fails', async () => {
    const world = setup();
    const { filed } = await fileCaptureParts(parts.slice(0, 1), world.writers);
    const forget = vi.fn(async () => {
      throw new Error('storage down');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const out = await undoDashAction({ ...world.dash, forget }, filed[0].actionId!);
    expect(out.ok).toBe(true);
    expect(world.tables['core.dash_actions'][0].status).toBe('undone');
    spy.mockRestore();
  });

  it('makes an aimed todo for the day picked, opens its page, and Undo takes it back', async () => {
    const world = setup();
    const days: (string | undefined)[] = [];
    const todo = world.writers.todo;
    const writers: CaptureWriters = {
      ...world.writers,
      todo: (text, day) => {
        days.push(day);
        return todo(text, day);
      },
    };

    const made = await makeCaptureKind('todo', { text: '  call the dentist ', day: 'tomorrow' }, writers);
    if (!made.ok) throw new Error(made.error);
    expect(days).toEqual(['tomorrow']);
    const id = world.tables['todo.tasks'][0].id as string;
    expect(made.filed).toMatchObject({
      place: 'todo',
      text: 'call the dentist',
      where: 'Todo · Tomorrow',
      ref: `todo.tasks:${id}`,
      page: `/todo/all?status=all&focus=${id}`,
    });
    // Recorded as the person's own, so Home's list of Dash's changes leaves it out.
    const [action] = world.tables['core.dash_actions'];
    expect(action).toMatchObject({ surface: 'capture', kind: 'add_todo', undo: { aimed: true } });
    expect(String(action.summary)).toBe('You added the todo "call the dentist".');
    expect(
      dashTodayEntry(
        { ...(action as Parameters<typeof dashTodayEntry>[0]), conversation_id: null, turn_id: null, input: null, declined_at: null },
        '2026-10-14',
      ),
    ).toBeNull();

    const out = await undoDashAction(world.dash, made.filed.actionId!);
    expect(out.ok).toBe(true);
    expect(world.tables['todo.tasks']).toEqual([]);
  });

  it('makes an aimed note on the role it was handed and opens the role', async () => {
    const world = setup();
    const made = await makeCaptureKind('job-note', { text: 'Recruiter is Sam', role: ROLE }, world.writers);
    if (!made.ok) throw new Error(made.error);
    expect(made.filed).toMatchObject({ place: 'jobs', page: `/jobs/roles/${ROLE.id}` });
    expect(world.tables['core.conversation_turns']).toMatchObject([
      { ref: `job_search.roles:${ROLE.id}`, author: 'me', body: 'Recruiter is Sam' },
    ]);
    expect(String(world.tables['core.dash_actions'][0].summary)).toBe(
      'You added a note to the role Product Analyst at Stripe.',
    );
  });

  it('makes a Shopping row from an aimed add, opens its page, and Undo takes it back (plan #1950.3.1)', async () => {
    const world = setup();
    world.tables['public.saved_items'] = [];
    const writers: CaptureWriters = {
      ...world.writers,
      shopping: {
        order: async () => ({ ok: false, error: 'not this one' }),
        item: async () => ({ ok: false, error: 'not this one' }),
        saved: async (text) => {
          const id = fakeId();
          world.tables['public.saved_items'].push({ id, user_id: ME, url: text, title: 'Green kettle' });
          return { ok: true, id, title: 'Green kettle' };
        },
      },
    };

    const made = await makeCaptureKind('saved-item', { text: 'https://example.com/kettle' }, writers);
    if (!made.ok) throw new Error(made.error);
    const id = world.tables['public.saved_items'][0].id as string;
    expect(made.filed).toMatchObject({
      place: null,
      where: 'Shopping · Saved',
      ref: `public.saved_items:${id}`,
      page: `/shopping/saved/${id}`,
    });
    const [action] = world.tables['core.dash_actions'];
    expect(action).toMatchObject({ surface: 'capture', kind: 'add_saved_item', undo: { aimed: true } });
    expect(String(action.summary)).toBe('You saved "Green kettle".');

    const out = await undoDashAction(world.dash, made.filed.actionId!);
    expect(out.ok).toBe(true);
    expect(world.tables['public.saved_items']).toEqual([]);
  });

  it('says so when a Shopping kind is aimed where there are no Shopping writers', async () => {
    const world = setup();
    expect(await makeCaptureKind('order', { text: 'a kettle for $30' }, world.writers)).toMatchObject({
      ok: false,
      error: 'That cannot be added from here. Open its list and press Add there.',
    });
    expect(world.tables['core.dash_actions']).toEqual([]);
  });

  it('makes a role from a sentence through its writer, opens it, and records it as yours (plan #1950.4)', async () => {
    const world = setup();
    const asked: unknown[] = [];
    const writers: CaptureWriters = {
      ...world.writers,
      role: async (input) => {
        asked.push(input);
        return { ok: true, roleId: ROLE.id, title: 'Product Analyst at Stripe' };
      },
    };
    const made = await makeCaptureKind('job-role', { text: 'Product Analyst at Stripe' }, writers);
    if (!made.ok) throw new Error(made.error);
    expect(asked).toEqual([{ url: null, title: 'Product Analyst', company: 'Stripe' }]);
    expect(made.filed).toMatchObject({ place: 'jobs', ref: `job_search.roles:${ROLE.id}`, page: `/jobs/roles/${ROLE.id}` });
    expect(world.tables['core.dash_actions'][0]).toMatchObject({
      kind: 'add_job_lead',
      summary: 'You saved Product Analyst at Stripe to your leads.',
      undo: { aimed: true },
    });
    // Without a writer bound, as on the shortcuts' route, it says so.
    expect(await makeCaptureKind('job-role', { text: 'Analyst at Ramp' }, world.writers)).toMatchObject({ ok: false });
  });

  it('starts a topic with the list pasted under it, opens it, and Undo takes it back (plan #1950.4)', async () => {
    const world = setup();
    world.tables['learn.tracks'] = [];
    world.tables['learn.readings'] = [];
    const writers: CaptureWriters = {
      ...world.writers,
      topic: async ({ title, readings }) => {
        const trackId = fakeId();
        world.tables['learn.tracks'].push({ id: trackId, user_id: ME, title });
        for (const reading of readings) {
          // Written before the record, as the writer does.
          world.tables['learn.readings'].push({ id: fakeId(), user_id: ME, track_id: trackId, title: reading.title, created_at: '2026-10-01T00:00:00Z' });
        }
        return { ok: true, trackId, readings: readings.length };
      },
    };
    const made = await makeCaptureKind('learn-topic', { text: 'Central banking\n- Lords of Finance\n- The Alchemists' }, writers);
    if (!made.ok) throw new Error(made.error);
    const trackId = world.tables['learn.tracks'][0].id as string;
    expect(made.filed).toMatchObject({ place: null, page: `/learn/t/${trackId}`, where: 'Learn · Reading lists' });
    expect(world.tables['learn.readings']).toHaveLength(2);
    expect(String(world.tables['core.dash_actions'][0].summary)).toBe(
      'You started the topic "Central banking" with 2 readings.',
    );

    const out = await undoDashAction(world.dash, made.filed.actionId!);
    expect(out.ok).toBe(true);
    expect(world.tables['learn.tracks']).toEqual([]);
  });

  it('opens a link saved before without recording it, so Undo cannot take an older reading (plan #1950.4)', async () => {
    const world = setup();
    const reading = fakeId();
    const writers: CaptureWriters = {
      ...world.writers,
      reading: async () => ({ ok: true, readingId: reading, title: 'How rates work', created: false }),
    };
    const made = await makeCaptureKind('learn-reading', { text: 'https://example.com/rates' }, writers);
    if (!made.ok) throw new Error(made.error);
    expect(made.filed).toMatchObject({ actionId: null, page: `/learn/r/${reading}` });
    expect(made.errors).toEqual(['"How rates work" was on your reading lists already.']);
    expect(world.tables['core.dash_actions']).toEqual([]);
    expect(await makeCaptureKind('learn-reading', { text: 'no link here' }, writers)).toMatchObject({ ok: false });
  });

  it('starts a quiz over named notes and pasted text, and opens it (plan #1950.4)', async () => {
    const world = setup();
    const asked: unknown[] = [];
    const quiz = fakeId();
    const writers: CaptureWriters = {
      ...world.writers,
      quiz: async (input) => {
        asked.push(input);
        return { ok: true, quizId: quiz, title: 'Monetary policy' };
      },
    };
    const made = await makeCaptureKind('learn-quiz', { text: 'Rates move prices.\n[[Monetary policy]]' }, writers);
    if (!made.ok) throw new Error(made.error);
    expect(asked).toEqual([{ paste: 'Rates move prices.', notes: ['Monetary policy'] }]);
    expect(made.filed).toMatchObject({ page: `/learn/quiz/${quiz}` });
    expect(world.tables['core.dash_actions'][0]).toMatchObject({ kind: 'add_quiz', subject_ref: `learn.quizzes:${quiz}` });
  });

  it('refuses an aimed add with nothing typed, and a note with no role', async () => {
    const world = setup();
    expect(await makeCaptureKind('todo', { text: '   ' }, world.writers)).toMatchObject({ ok: false });
    expect(await makeCaptureKind('job-note', { text: 'Recruiter is Sam' }, world.writers)).toMatchObject({ ok: false });
    expect(world.tables['todo.tasks']).toEqual([]);
    expect(world.tables['core.dash_actions']).toEqual([]);
  });

  it('makes an aimed goal in the area it was handed, opens it, and Undo takes it back (plan #1950.5)', async () => {
    const world = setup();
    const area = { id: '00000000-0000-4000-8000-0000000000d1', title: 'Health' };
    const made = await makeCaptureKind('goal', { text: 'Run a half marathon', under: area }, world.writers);
    if (!made.ok) throw new Error(made.error);
    const [goal] = world.tables['goals.items'];
    expect(goal).toMatchObject({ area_id: area.id, title: 'Run a half marathon' });
    expect(made.filed).toMatchObject({
      place: null,
      module: 'goals',
      where: 'Goals · Health',
      ref: `goals.items:${goal.id}`,
    });
    expect(made.filed.page).toBeTruthy();
    expect(world.tables['core.dash_actions'][0]).toMatchObject({ kind: 'add_goal', undo: { aimed: true } });
    expect(String(world.tables['core.dash_actions'][0].summary)).toBe('You added the goal "Run a half marathon".');

    const out = await undoDashAction(world.dash, made.filed.actionId!);
    expect(out.ok).toBe(true);
    expect(world.tables['goals.items']).toEqual([]);
  });

  it('puts an aimed step under its feature, and a feature in the module it was aimed at', async () => {
    const world = setup();
    const feature = { id: '00000000-0000-4000-8000-0000000000e1', title: 'Capture is the one way to add anything' };
    const step = await makeCaptureKind('plan-step', { text: 'Goals add through capture', under: feature }, world.writers);
    const top = await makeCaptureKind('plan-feature', { text: 'A calmer plan page', under: { id: 'dev', title: 'Dev' } }, world.writers);
    if (!step.ok || !top.ok) throw new Error('not made');
    expect(world.tables['public.plan_items']).toMatchObject([
      { title: 'Goals add through capture', parent_id: feature.id, module: null },
      { title: 'A calmer plan page', parent_id: null, module: 'dev' },
    ]);
    expect(step.filed.where).toBe('Plan · Capture is the one way to add anything');
  });

  it('files a note for Dev with the page it came from and its files, and stays on the page', async () => {
    const world = setup();
    const attached: string[] = [];
    const writers: CaptureWriters = { ...world.writers, attach: async (ref) => (attached.push(ref), 1) };
    const made = await makeCaptureKind('dev-note', { text: 'The plan scrolls sideways', page: '/dev/plan' }, writers);
    if (!made.ok) throw new Error(made.error);
    const [note] = world.tables['public.feedback_items'];
    expect(note).toMatchObject({ body: 'The plan scrolls sideways', page_path: '/dev/plan', kind: 'feature' });
    expect(attached).toEqual([`public.feedback_items:${note.id}`]);
    expect(made.filed).toMatchObject({ page: null, files: 1, where: 'Dev · Notes' });
  });

  it('refuses a goal or a step aimed at nothing to go under', async () => {
    const world = setup();
    expect(await makeCaptureKind('goal', { text: 'Run' }, world.writers)).toMatchObject({ ok: false });
    expect(await makeCaptureKind('plan-step', { text: 'Do it' }, world.writers)).toMatchObject({ ok: false });
    expect(world.tables['goals.items']).toEqual([]);
    expect(world.tables['public.plan_items']).toEqual([]);
  });

  it('names each Goals row a capture touched once', () => {
    const step = '00000000-0000-4000-8000-0000000000c1';
    const goal = '00000000-0000-4000-8000-0000000000c2';
    expect(
      goalRefs([
        GOAL_LINE,
        { kind: 'add', step_id: step, title: 'Book a physio', step_kind: 'mine', goal_title: 'Run', undone_at: null },
        {
          kind: 'progress',
          entry_id: fakeId(),
          item_id: step,
          step_title: 'Book a physio',
          goal_title: 'Run',
          text: 'called',
          quantity: null,
          unit: null,
          happened_on: '2026-10-09',
          undone_at: null,
        },
        { kind: 'reading', reading_id: fakeId(), goal_id: goal, goal_title: 'Weigh', value: 70, unit: 'kg', undone_at: null },
      ]),
    ).toEqual([`goals.items:${GOAL_LINE.step_id}`, `goals.items:${step}`, `goals.items:${goal}`]);
  });
});
