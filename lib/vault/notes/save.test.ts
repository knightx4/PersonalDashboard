import { describe, expect, it, vi } from 'vitest';
import {
  matchLineEndings,
  saveNote,
  withEditedBody,
  type SavableNote,
  type SavedNoteRow,
  type SaveNotePorts,
} from '@/lib/vault/notes/save';
import { planIncremental } from '@/lib/vault/sync/plan';
import {
  VaultAuthError,
  VaultConflictError,
  VaultReadOnlyError,
  VaultSourceError,
  type VaultSource,
} from '@/lib/vault/providers/types';

const RAW = '---\ntags: [rent]\nupdated: 2026-09-01\n---\n\n# Rent\n\nPaid in August.\n';
const NOTE: SavableNote = {
  id: 'note-1',
  path: 'Money/Rent.md',
  title: 'Rent',
  body: '# Rent\n\nPaid in August.\n',
  blobSha: 'blob-old',
};

type Writes = Array<{ path: string; text: string; expected: string; message: string }>;

function source(opts: { raw?: string; fail?: Error } = {}): VaultSource & { writes: Writes } {
  const writes: Writes = [];
  return {
    provider: 'github',
    writes,
    headCommit: vi.fn(),
    snapshot: vi.fn(),
    diff: vi.fn(),
    readBlobBytes: vi.fn(),
    async readBlob() {
      return opts.raw ?? RAW;
    },
    async writeNote(path, text, expected, message) {
      if (opts.fail) throw opts.fail;
      writes.push({ path, text, expected, message });
      return { blobSha: 'blob-new', commitSha: 'commit-1' };
    },
  };
}

function harness(opts: { note?: SavableNote | null; src?: VaultSource | 'none' | 'reauth' } = {}) {
  const stored: Array<{ id: string; expected: string; row: SavedNoteRow }> = [];
  const after: string[] = [];
  let opened = 0;
  const ports: SaveNotePorts = {
    loadNote: async (path) => {
      const note = opts.note === undefined ? NOTE : opts.note;
      return note && note.path === path ? note : null;
    },
    openSource: async () => {
      opened += 1;
      return opts.src ?? source();
    },
    storeNote: async (id, expected, row) => {
      stored.push({ id, expected, row });
    },
    afterSave: (id) => after.push(id),
    now: () => new Date('2026-10-02T09:00:00Z'),
  };
  return { ports, stored, after, opened: () => opened };
}

const EDIT = '# Rent\n\nPaid in August and September.\n';

describe('saveNote', () => {
  it('commits the edit, keeps the frontmatter, and stores the new blob', async () => {
    const src = source();
    const h = harness({ src });

    const result = await saveNote(h.ports, {
      path: NOTE.path,
      text: EDIT,
      expectedBlobSha: 'blob-old',
    });

    expect(result).toEqual({ ok: true, blobSha: 'blob-new', commitSha: 'commit-1' });
    expect(src.writes).toEqual([
      {
        path: 'Money/Rent.md',
        text: '---\ntags: [rent]\nupdated: 2026-09-01\n---\n\n' + EDIT,
        expected: 'blob-old',
        message: 'Edit Rent from Dash',
      },
    ]);
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0].id).toBe('note-1');
    expect(h.stored[0].expected).toBe('blob-old');
    expect(h.stored[0].row).toMatchObject({
      title: 'Rent',
      body: EDIT,
      blobSha: 'blob-new',
      frontmatter: { tags: ['rent'] },
    });
    expect(h.stored[0].row.sizeBytes).toBe(new TextEncoder().encode(src.writes[0].text).byteLength);
    expect(h.after).toEqual(['note-1']);
  });

  it('leaves the next sync nothing to rewrite for the saved note', async () => {
    const h = harness();
    await saveNote(h.ports, { path: NOTE.path, text: EDIT, expectedBlobSha: 'blob-old' });

    const known = new Map([[NOTE.path, { blobSha: h.stored[0].row.blobSha, deleted: false }]]);
    const plan = planIncremental({
      changes: [{ kind: 'upsert', path: NOTE.path, blobSha: 'blob-new', sizeBytes: 60 }],
      known,
      subpath: '',
    });
    expect(plan.fetch).toEqual([]);
    expect(plan.unchanged).toEqual([NOTE.path]);
  });

  it('refuses a stale SHA without touching the repository', async () => {
    const src = source();
    const h = harness({ note: { ...NOTE, blobSha: 'blob-synced' }, src });

    const result = await saveNote(h.ports, {
      path: NOTE.path,
      text: EDIT,
      expectedBlobSha: 'blob-old',
    });

    expect(result).toMatchObject({ ok: false, reason: 'changed' });
    expect(h.opened()).toBe(0);
    expect(src.writes).toEqual([]);
    expect(h.stored).toEqual([]);
  });

  it('reports a note changed on GitHub since it was opened, and stores nothing', async () => {
    const h = harness({ src: source({ fail: new VaultConflictError('stale', NOTE.path) }) });

    const result = await saveNote(h.ports, {
      path: NOTE.path,
      text: EDIT,
      expectedBlobSha: 'blob-old',
    });

    expect(result).toMatchObject({ ok: false, reason: 'changed' });
    expect(h.stored).toEqual([]);
    expect(h.after).toEqual([]);
  });

  it('treats a note that is not yours as not there, and opens no source', async () => {
    const h = harness({ note: null });

    const result = await saveNote(h.ports, {
      path: 'Someone/Else.md',
      text: EDIT,
      expectedBlobSha: 'blob-old',
    });

    expect(result).toMatchObject({ ok: false, reason: 'not-found' });
    expect(h.opened()).toBe(0);
    expect(h.stored).toEqual([]);
  });

  it('names a read-only token, a refused token and other failures apart', async () => {
    const cases: Array<[Error, string]> = [
      [new VaultReadOnlyError('403'), 'read-only'],
      [new VaultAuthError('401'), 'reconnect'],
      [new VaultSourceError('rate limited', 429), 'error'],
    ];
    for (const [fail, reason] of cases) {
      const h = harness({ src: source({ fail }) });
      const result = await saveNote(h.ports, {
        path: NOTE.path,
        text: EDIT,
        expectedBlobSha: 'blob-old',
      });
      expect(result).toMatchObject({ ok: false, reason });
    }
  });

  it('asks for a reconnect when there is no usable connection', async () => {
    for (const src of ['none', 'reauth'] as const) {
      const h = harness({ src });
      const result = await saveNote(h.ports, {
        path: NOTE.path,
        text: EDIT,
        expectedBlobSha: 'blob-old',
      });
      expect(result).toMatchObject({ ok: false, reason: 'reconnect' });
    }
  });

  it('writes nothing when the text has not changed', async () => {
    const src = source();
    const h = harness({ src });

    const result = await saveNote(h.ports, {
      path: NOTE.path,
      text: NOTE.body.replace(/\n/g, '\r\n'),
      expectedBlobSha: 'blob-old',
    });

    expect(result).toEqual({ ok: true, blobSha: 'blob-old', commitSha: null });
    expect(src.writes).toEqual([]);
    expect(h.stored).toEqual([]);
  });

  it('still reports the save when storing it afterwards fails', async () => {
    const h = harness();
    h.ports.storeNote = async () => {
      throw new Error('db down');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await saveNote(h.ports, {
      path: NOTE.path,
      text: EDIT,
      expectedBlobSha: 'blob-old',
    });

    expect(result).toMatchObject({ ok: true, blobSha: 'blob-new' });
    spy.mockRestore();
  });
});

describe('withEditedBody', () => {
  it('replaces a note with no frontmatter whole', () => {
    expect(withEditedBody('Old text\n', 'a.md', 'New text\n')).toBe('New text\n');
  });

  it('keeps the frontmatter block byte for byte', () => {
    const raw = '---\nkey:   "spaced"\n---\n\n\nOld\n';
    expect(withEditedBody(raw, 'a.md', 'New\n')).toBe('---\nkey:   "spaced"\n---\n\n\nNew\n');
  });
});

describe('matchLineEndings', () => {
  it('turns the textarea CRLF back into LF for an LF file', () => {
    expect(matchLineEndings('a\r\nb\r\n', 'x\ny\n')).toBe('a\nb\n');
  });

  it('keeps CRLF for a CRLF file', () => {
    expect(matchLineEndings('a\nb\r\n', 'x\r\ny\r\n')).toBe('a\r\nb\r\n');
  });
});
