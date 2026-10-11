import { describe, expect, it, vi } from 'vitest';
import { fileCaptureParts, goalRefs, type CaptureWriters } from '@/lib/capture/file';
import type { CapturePart } from '@/lib/capture/sort';
import { markDashActionUndone, recordDashAction, undoDashAction, undoneByVault } from '@/lib/core/dash-actions';
import { writeRoleNote } from '@/lib/dash/writes';
import type { FiledEntry } from '@/lib/goals/capture';
import { undoDashTodayWith } from '@/lib/shell/dash-today';
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
