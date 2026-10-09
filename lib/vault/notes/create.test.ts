import { describe, expect, it, vi } from 'vitest';
import {
  createCapturedNote,
  inboxNoteName,
  inboxNotePath,
  removeCapturedNote,
  VAULT_WRITE_ERRORS,
  type CreateNotePorts,
  type RemoveNotePorts,
} from '@/lib/vault/notes/create';
import { VaultConflictError, VaultReadOnlyError, type VaultSource } from '@/lib/vault/providers/types';

const NOW = new Date('2026-10-04T09:00:00Z');

describe('naming a note from its first line', () => {
  it('drops markdown markers and characters a file name cannot hold', () => {
    expect(inboxNoteName('# Rent: what to ask?\nmore', NOW)).toBe('Rent what to ask');
    expect(inboxNoteName('- [link] to #tag', NOW)).toBe('link to tag');
    expect(inboxNoteName('\n\n  Quote from Ana  ', NOW)).toBe('Quote from Ana');
  });

  it('cuts a long line at a word, and names an empty one by the day', () => {
    const long = 'A thought about how the morning walk changes what I notice in the afternoon light';
    const name = inboxNoteName(long, NOW);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(name)).toBe(true);
    expect(inboxNoteName('***', NOW)).toBe('Capture 2026-10-04');
  });

  it('numbers the path from the second attempt', () => {
    expect(inboxNotePath('Idea')).toBe('Inbox/Idea.md');
    expect(inboxNotePath('Idea', 2)).toBe('Inbox/Idea 2.md');
  });
});

function ports(source: Partial<VaultSource>, stored: unknown[] = []): CreateNotePorts {
  return {
    openSource: async () => source as VaultSource,
    storeNote: async (row) => {
      stored.push(row);
      return 'note-1';
    },
    afterSave: vi.fn(),
    now: () => NOW,
  };
}

describe('createCapturedNote', () => {
  it('commits the note and stores it at the blob SHA the commit made', async () => {
    const stored: unknown[] = [];
    const createNote = vi.fn(async () => ({ blobSha: 'b1', commitSha: 'c1' }));
    const result = await createCapturedNote(ports({ createNote }, stored), 'Buy a kite\r\nfor Sunday');

    expect(createNote).toHaveBeenCalledWith('Inbox/Buy a kite.md', 'Buy a kite\nfor Sunday\n', 'Add Buy a kite from Dash');
    expect(result).toEqual({ ok: true, noteId: 'note-1', path: 'Inbox/Buy a kite.md', title: 'Buy a kite', blobSha: 'b1', commitSha: 'c1' });
    expect(stored).toMatchObject([{ path: 'Inbox/Buy a kite.md', blobSha: 'b1', body: 'Buy a kite\nfor Sunday\n' }]);
  });

  // The vault page's New note gives a name and a body (note 09ff8039).
  it('names the note by the title it is given, and keeps the body as written', async () => {
    const createNote = vi.fn(async () => ({ blobSha: 'b1', commitSha: 'c1' }));
    const result = await createCapturedNote(ports({ createNote }), 'Some thoughts\non finding yourself', 'Against: finding');
    expect(createNote).toHaveBeenCalledWith(
      'Inbox/Against finding.md',
      'Some thoughts\non finding yourself\n',
      expect.any(String),
    );
    expect(result).toMatchObject({ ok: true, path: 'Inbox/Against finding.md' });
  });

  it('never writes over a note already at the name, and tries the next number', async () => {
    const createNote = vi
      .fn()
      .mockRejectedValueOnce(new VaultConflictError('exists', 'Inbox/Idea.md'))
      .mockResolvedValueOnce({ blobSha: 'b2', commitSha: 'c2' });
    const result = await createCapturedNote(ports({ createNote }), 'Idea');
    expect(createNote.mock.calls.map((call) => call[0])).toEqual(['Inbox/Idea.md', 'Inbox/Idea 2.md']);
    expect(result).toMatchObject({ ok: true, path: 'Inbox/Idea 2.md' });
  });

  it('says so when the token cannot write, or no vault is connected', async () => {
    const readOnly = await createCapturedNote(
      ports({ createNote: async () => Promise.reject(new VaultReadOnlyError('no')) }),
      'Idea',
    );
    expect(readOnly).toEqual({ ok: false, reason: 'read-only', error: VAULT_WRITE_ERRORS['read-only'] });

    const none = await createCapturedNote({ ...ports({}), openSource: async () => 'none' }, 'Idea');
    expect(none).toMatchObject({ ok: false, reason: 'reconnect' });
  });
});

function removePorts(note: { blobSha: string; deleted?: boolean } | null, source: Partial<VaultSource>) {
  const marked: string[] = [];
  const p: RemoveNotePorts = {
    openSource: async () => source as VaultSource,
    loadNote: async (id) =>
      note ? { id, path: 'Inbox/Idea.md', title: 'Idea', blobSha: note.blobSha, deleted: note.deleted ?? false } : null,
    markDeleted: async (id) => {
      marked.push(id);
    },
  };
  return { ports: p, marked };
}

describe('removeCapturedNote', () => {
  it('commits the removal and marks the stored note deleted', async () => {
    const deleteNote = vi.fn(async () => 'c3');
    const { ports: p, marked } = removePorts({ blobSha: 'b1' }, { deleteNote });
    expect(await removeCapturedNote(p, 'note-1', 'b1')).toEqual({ ok: true });
    expect(deleteNote).toHaveBeenCalledWith('Inbox/Idea.md', 'b1', 'Remove Idea from Dash');
    expect(marked).toEqual(['note-1']);
  });

  it('refuses once the note has been edited or removed since, touching nothing', async () => {
    const deleteNote = vi.fn();
    const edited = removePorts({ blobSha: 'b9' }, { deleteNote });
    expect(await removeCapturedNote(edited.ports, 'note-1', 'b1')).toMatchObject({ ok: false, error: /changed since/ });

    const gone = removePorts({ blobSha: 'b1', deleted: true }, { deleteNote });
    expect(await removeCapturedNote(gone.ports, 'note-1', 'b1')).toMatchObject({ ok: false, error: /deleted/ });

    const moved = removePorts({ blobSha: 'b1' }, { deleteNote: async () => Promise.reject(new VaultConflictError('x', 'p')) });
    expect(await removeCapturedNote(moved.ports, 'note-1', 'b1')).toMatchObject({ ok: false, error: /changed since/ });
    expect(moved.marked).toEqual([]);
    expect(deleteNote).not.toHaveBeenCalled();
  });
});
