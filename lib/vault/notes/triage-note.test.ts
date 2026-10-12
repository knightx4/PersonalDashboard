import { describe, expect, it, vi } from 'vitest';
import type { CreateNotePorts } from '@/lib/vault/notes/create';
import type { SaveNotePorts } from '@/lib/vault/notes/save';
import { renderTriageNote, syncTriageNote } from '@/lib/vault/notes/triage-note';
import { isTriageNotePath, TRIAGE_NOTE_PATH } from '@/lib/vault/paths';
import { VaultConflictError, type VaultSource } from '@/lib/vault/providers/types';

const ONE = { path: 'Inbox/Call the dentist.md', body: 'Call the dentist\n\nabout the crown\n' };
const TWO = { path: 'Inbox/Book flights.md', body: 'Book flights' };

describe('renderTriageNote', () => {
  it('lists each quick note with a link and its text quoted', () => {
    const text = renderTriageNote([ONE, TWO]);
    expect(text).toContain('2 quick notes waiting.');
    expect(text).toContain('## [[Inbox/Call the dentist|Call the dentist]]\n\n> Call the dentist\n>\n> about the crown');
    expect(text).toContain('## [[Inbox/Book flights|Book flights]]\n\n> Book flights');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('says so when nothing is waiting', () => {
    expect(renderTriageNote([])).toContain('Nothing is waiting.');
  });

  it('is the same for the same notes, so an unchanged Inbox writes nothing', () => {
    expect(renderTriageNote([ONE])).toBe(renderTriageNote([{ ...ONE }]));
  });

  it('cuts a very long quick note short', () => {
    expect(renderTriageNote([{ path: 'Inbox/Long.md', body: 'x'.repeat(5000) }])).toContain('Cut short');
  });
});

describe('isTriageNotePath', () => {
  it('is the top-level note only', () => {
    expect(isTriageNotePath(TRIAGE_NOTE_PATH)).toBe(true);
    expect(isTriageNotePath('Inbox/Quick note triage.md')).toBe(false);
  });
});

function setup(stored: { body: string; blobSha: string } | null, source: Partial<VaultSource> = {}) {
  const commits: string[] = [];
  const repo = {
    readBlob: async () => stored?.body ?? '',
    writeNote: async (path: string, _text: string, _expected: string, message: string) => {
      commits.push(`write ${path}: ${message}`);
      return { blobSha: 'w1', commitSha: 'c1' };
    },
    createNote: async (path: string, text: string) => {
      commits.push(`create ${path}`);
      expect(text).toContain('quick note');
      return { blobSha: 'n1', commitSha: 'c2' };
    },
    ...source,
  } as VaultSource;
  const save: SaveNotePorts = {
    loadNote: async (path) =>
      stored && path === TRIAGE_NOTE_PATH
        ? { id: 'triage', path, title: 'Quick note triage', body: stored.body, blobSha: stored.blobSha }
        : null,
    openSource: async () => repo,
    storeNote: vi.fn(async () => {}),
    afterSave: vi.fn(),
  };
  const create: CreateNotePorts = {
    openSource: async () => repo,
    storeNote: vi.fn(async () => 'new-id'),
    afterSave: vi.fn(),
  };
  return { ports: { save, create }, commits, create };
}

describe('syncTriageNote', () => {
  it('creates the note at the top of the vault when quick notes are waiting', async () => {
    const { ports, commits, create } = setup(null);
    expect(await syncTriageNote(ports, [ONE])).toBe('created');
    expect(commits).toEqual(['create Quick note triage.md']);
    expect(create.storeNote).toHaveBeenCalledWith(expect.objectContaining({ path: TRIAGE_NOTE_PATH }));
  });

  it('does not create an empty note', async () => {
    const { ports, commits } = setup(null);
    expect(await syncTriageNote(ports, [])).toBe('skipped');
    expect(commits).toEqual([]);
  });

  it('writes nothing when the note already says the same', async () => {
    const { ports, commits } = setup({ body: renderTriageNote([ONE]), blobSha: 'b1' });
    expect(await syncTriageNote(ports, [ONE])).toBe('unchanged');
    expect(commits).toEqual([]);
  });

  it('rewrites the note once a quick note is filed', async () => {
    const { ports, commits } = setup({ body: renderTriageNote([ONE, TWO]), blobSha: 'b1' }, {
      readBlob: async () => renderTriageNote([ONE, TWO]),
    });
    expect(await syncTriageNote(ports, [TWO])).toBe('written');
    expect(commits).toEqual(['write Quick note triage.md: Edit Quick note triage from Dash']);
  });

  it('empties the note rather than deleting it when the Inbox is clear', async () => {
    const { ports, commits } = setup({ body: renderTriageNote([ONE]), blobSha: 'b1' }, {
      readBlob: async () => renderTriageNote([ONE]),
    });
    expect(await syncTriageNote(ports, [])).toBe('written');
    expect(commits).toHaveLength(1);
  });

  it('gives up quietly when the file changed in Obsidian', async () => {
    const { ports } = setup({ body: 'old', blobSha: 'b1' }, {
      readBlob: async () => 'old',
      writeNote: async () => {
        throw new VaultConflictError('stale', TRIAGE_NOTE_PATH);
      },
    });
    expect(await syncTriageNote(ports, [ONE])).toBe('failed');
  });

  it('never writes a numbered copy when a file is already at the path', async () => {
    const createNote = vi.fn(async () => {
      throw new VaultConflictError('exists', TRIAGE_NOTE_PATH);
    });
    const { ports } = setup(null, { createNote });
    expect(await syncTriageNote(ports, [ONE])).toBe('failed');
    expect(createNote).toHaveBeenCalledTimes(1);
  });
});
