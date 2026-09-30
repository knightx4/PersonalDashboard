/**
 * Asking Maya from a note's page (plan #1285).
 *
 * The action is driven with its collaborators replaced: the note read, the
 * thought and the store. What is pinned is the order of things that matter:
 * a note the vault does not read is refused before anything is sent, spend is
 * recorded whether or not the thought came out, and a thought that did is
 * stored in the note's thread before the page is revalidated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ME = '00000000-0000-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  note: null as null | { id: string; path: string; body: string; blobSha: string },
  result: null as unknown,
  calls: [] as string[],
  stored: [] as unknown[],
  spend: [] as { operation: string; reports: unknown[] }[],
  revalidated: [] as string[],
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));
vi.mock('@/lib/auth/server', () => ({
  requireUser: async () => ({ id: ME, email: 'me@example.com' }),
}));
vi.mock('@/lib/vault/auth/server', () => ({ createVaultClient: async () => ({}) }));
vi.mock('@/lib/core/auth/server', () => ({ createCoreClient: async () => ({}) }));
vi.mock('@/lib/vault/notes/load', () => ({ loadNote: async () => state.note }));
vi.mock('@/lib/learn/spend', () => ({
  collectSpend: () => {
    const reports: unknown[] = [];
    return { reports, sink: (report: unknown) => reports.push(report) };
  },
  recordLearnSpend: async (_user: string, operation: string, reports: unknown[]) => {
    state.spend.push({ operation, reports });
  },
}));
vi.mock('@/lib/vault/maya/thought', () => ({
  MAYA_THOUGHT_OPERATION: 'write-maya-thought',
  writeThought: async (input: { noteId: string; onSpend: (report: unknown) => void }) => {
    state.calls.push(input.noteId);
    input.onSpend({ model: 'claude-opus-5' });
    return state.result;
  },
}));
vi.mock('@/lib/vault/maya/threads', () => ({
  mayaThreadStore: () => ({}),
  storeThought: async (_store: unknown, input: unknown) => {
    state.stored.push(input);
    return { threadId: 'thread-1', question: 'Q', opened: true };
  },
}));

const { askMaya } = await import('@/app/vault/n/[...path]/actions');

function form(path: string): FormData {
  const data = new FormData();
  data.set('notePath', path);
  return data;
}

const WRITTEN = {
  ok: true,
  question: 'Is the commute worth the house?',
  body: '',
  points: [],
  noteBlobSha: 'sha1',
  model: 'claude-opus-5',
};

beforeEach(() => {
  state.note = {
    id: 'note-1',
    path: 'Ideas/Commute.md',
    body: 'A long commute buys a bigger house.',
    blobSha: 'sha1',
  };
  state.result = WRITTEN;
  state.calls = [];
  state.stored = [];
  state.spend = [];
  state.revalidated = [];
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

describe('askMaya', () => {
  it('stores the thought in the note thread, records spend and revalidates the note', async () => {
    expect(await askMaya({}, form('Ideas/Commute.md'))).toEqual({ threadId: 'thread-1' });
    expect(state.calls).toEqual(['note-1']);
    expect(state.stored).toEqual([{ noteId: 'note-1', origin: 'asked', thought: WRITTEN }]);
    expect(state.spend).toEqual([
      { operation: 'write-maya-thought', reports: [{ model: 'claude-opus-5' }] },
    ]);
    expect(state.revalidated).toEqual(['/vault/n/Ideas/Commute.md']);
  });

  it('refuses a note the vault does not read before anything is sent', async () => {
    state.note = { id: 'note-2', path: 'Me/2026-09-30.md', body: 'Today.', blobSha: 'sha2' };
    const result = await askMaya({}, form('Me/2026-09-30.md'));
    expect(result.error).toBe('Not read: notes in Me/ are journals.');
    expect(state.calls).toEqual([]);
    expect(state.spend).toEqual([]);
  });

  it('says so when the note is gone', async () => {
    state.note = null;
    expect((await askMaya({}, form('Gone.md'))).error).toBe(
      'That note is not in the vault any more.',
    );
  });

  it('asks for the key when it is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await askMaya({}, form('Ideas/Commute.md'))).error).toBe(
      'Asking Maya needs ANTHROPIC_API_KEY to be set.',
    );
    expect(state.calls).toEqual([]);
  });

  it('records spend on a failed thought and stores nothing', async () => {
    state.result = { ok: false, reason: 'error', detail: 'the model stopped early' };
    const result = await askMaya({}, form('Ideas/Commute.md'));
    expect(result.error).toBe('Maya could not finish the thought: the model stopped early');
    expect(state.spend).toHaveLength(1);
    expect(state.stored).toEqual([]);
    expect(state.revalidated).toEqual([]);
  });
});
