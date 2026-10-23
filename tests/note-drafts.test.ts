/**
 * The vault editor's drafts (lib/vault/notes/drafts.ts): a save keeps the text
 * without a commit, is refused when the note changed somewhere else, and the
 * tick's commit clears the draft, or keeps why it was refused.
 */
import { describe, expect, it, vi } from 'vitest';
import { commitDraft, saveDraft, type DraftPorts, type DueDraft, type NoteDraft } from '@/lib/vault/notes/drafts';
import type { SaveNotePorts } from '@/lib/vault/notes/save';

vi.mock('@/lib/vault/notes/save', () => ({
  saveNote: vi.fn(),
}));
const { saveNote } = await import('@/lib/vault/notes/save');

function ports(note: { body: string; blobSha: string } | null, draft: NoteDraft | null = null) {
  const calls: string[] = [];
  const p: DraftPorts = {
    loadNote: async () => (note ? { id: 'n1', ...note } : null),
    loadDraft: async () => draft,
    insertDraft: async (_id, body, base) => void calls.push(`insert ${body} @${base}`),
    updateDraft: async (_id, body) => void calls.push(`update ${body}`),
    deleteDraft: async () => void calls.push('delete'),
  };
  return { p, calls };
}

const draftOf = (body: string, base = 'v1'): NoteDraft => ({
  noteId: 'n1',
  body,
  baseBlobSha: base,
  updatedAt: '2026-10-20T10:00:00Z',
  failure: null,
});

describe('saving a draft', () => {
  it('starts a draft from the note as the vault has it', async () => {
    const { p, calls } = ports({ body: 'a', blobSha: 'v1' });
    expect(await saveDraft(p, { path: 'x.md', text: 'ab', from: 'a' })).toEqual({ ok: true });
    expect(calls).toEqual(['insert ab @v1']);
  });

  it('updates a draft already waiting', async () => {
    const { p, calls } = ports({ body: 'a', blobSha: 'v1' }, draftOf('ab'));
    await saveDraft(p, { path: 'x.md', text: 'abc', from: 'ab' });
    expect(calls).toEqual(['update abc']);
  });

  it('drops the draft when the text is back to what the vault holds', async () => {
    const { p, calls } = ports({ body: 'a', blobSha: 'v1' }, draftOf('ab'));
    await saveDraft(p, { path: 'x.md', text: 'a', from: 'ab' });
    expect(calls).toEqual(['delete']);
  });

  it('is refused when the note changed since the editor last saved', async () => {
    const { p, calls } = ports({ body: 'from Obsidian', blobSha: 'v2' });
    expect(await saveDraft(p, { path: 'x.md', text: 'mine', from: 'a' })).toEqual({
      ok: false,
      reason: 'changed',
    });
    expect(calls).toEqual([]);
  });

  it('still saves after the tick committed the last draft', async () => {
    // The commit moved the note to v2 with the text the editor last saved.
    const { p, calls } = ports({ body: 'ab', blobSha: 'v2' });
    await saveDraft(p, { path: 'x.md', text: 'abc', from: 'ab' });
    expect(calls).toEqual(['insert abc @v2']);
  });
});

describe('committing a draft', () => {
  const due: DueDraft = {
    noteId: 'n1',
    userId: 'u1',
    path: 'x.md',
    body: 'ab',
    baseBlobSha: 'v1',
    updatedAt: '2026-10-20T10:00:00Z',
  };

  function commitPorts() {
    const calls: string[] = [];
    return {
      calls,
      p: {
        savePorts: () => ({}) as SaveNotePorts,
        clearDraft: async () => void calls.push('clear'),
        rebaseDraft: async (_d: DueDraft, sha: string) => void calls.push(`rebase ${sha}`),
        refuseDraft: async (_d: DueDraft, failure: string) => void calls.push(`refuse ${failure}`),
      },
    };
  }

  it('commits the draft against the version it started from, then clears it', async () => {
    vi.mocked(saveNote).mockResolvedValueOnce({ ok: true, blobSha: 'v2', commitSha: 'c1' });
    const { p, calls } = commitPorts();
    expect(await commitDraft(p, due)).toEqual({ ok: true, committed: true });
    expect(vi.mocked(saveNote).mock.lastCall?.[1]).toEqual({ path: 'x.md', text: 'ab', expectedBlobSha: 'v1' });
    expect(calls).toEqual(['clear', 'rebase v2']);
  });

  it('keeps why a commit was refused', async () => {
    vi.mocked(saveNote).mockResolvedValueOnce({ ok: false, reason: 'changed', detail: 'x' });
    const { p, calls } = commitPorts();
    await commitDraft(p, due);
    expect(calls).toEqual(['refuse changed']);
  });

  it('leaves the draft waiting after any other failure', async () => {
    vi.mocked(saveNote).mockResolvedValueOnce({ ok: false, reason: 'error', detail: 'x' });
    const { p, calls } = commitPorts();
    expect(await commitDraft(p, due)).toEqual({ ok: false, reason: 'error' });
    expect(calls).toEqual([]);
  });
});
