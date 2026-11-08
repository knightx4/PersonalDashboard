import { describe, expect, it, vi } from 'vitest';
import type { CreateNotePorts, NewNoteRow } from '@/lib/vault/notes/create';
import { appendQuickNote, FILE_ERRORS, fileQuickNote, filedLine, type FileQuickNotePorts } from '@/lib/vault/notes/file';
import type { SaveNotePorts } from '@/lib/vault/notes/save';
import { parseQuickSections, quickSectionFingerprint, withQuickSections } from '@/lib/vault/notes/quick-sections';
import { VaultConflictError, VaultReadOnlyError, type VaultSource } from '@/lib/vault/providers/types';

const NOW = new Date('2026-10-10T09:00:00Z');

type Row = { id: string; path: string; title: string; body: string; blobSha: string; deleted: boolean };

/**
 * A vault of stored notes and the repository behind them, recording every
 * commit in order, so a test can read what happened and in which order.
 */
function vault(notes: Row[], source: Partial<VaultSource> = {}) {
  const rows = new Map(notes.map((note) => [note.path, { ...note }]));
  const blobs = new Map(notes.map((note) => [note.blobSha, note.body]));
  const commits: string[] = [];
  let n = 0;

  const repo: VaultSource = {
    readBlob: async (sha: string) => blobs.get(sha) ?? '',
    writeNote: async (path: string, text: string, expected: string, message: string) => {
      if (rows.get(path)?.blobSha !== expected) throw new VaultConflictError('stale', path);
      const blobSha = `w${(n += 1)}`;
      blobs.set(blobSha, text);
      commits.push(`write ${path}: ${message}`);
      return { blobSha, commitSha: `c${n}` };
    },
    createNote: async (path: string, text: string, message: string) => {
      if (rows.has(path) && !rows.get(path)!.deleted) throw new VaultConflictError('exists', path);
      const blobSha = `n${(n += 1)}`;
      blobs.set(blobSha, text);
      commits.push(`create ${path}: ${message}`);
      return { blobSha, commitSha: `c${n}` };
    },
    deleteNote: async (path: string, _expected: string, message: string) => {
      commits.push(`delete ${path}: ${message}`);
      return `c${(n += 1)}`;
    },
    ...source,
  } as VaultSource;

  const byId = (id: string) => [...rows.values()].find((row) => row.id === id) ?? null;

  const save: SaveNotePorts = {
    loadNote: async (path) => {
      const row = rows.get(path);
      return row && !row.deleted ? { id: row.id, path: row.path, title: row.title, body: row.body, blobSha: row.blobSha } : null;
    },
    openSource: async () => repo,
    storeNote: async (id, _expected, saved) => {
      const row = byId(id)!;
      Object.assign(row, { body: saved.body, blobSha: saved.blobSha });
    },
    afterSave: vi.fn(),
    now: () => NOW,
  };
  const create: CreateNotePorts = {
    openSource: async () => repo,
    storeNote: async (row: NewNoteRow) => {
      rows.set(row.path, { id: `id-${row.path}`, path: row.path, title: row.title, body: row.body, blobSha: row.blobSha, deleted: false });
      return `id-${row.path}`;
    },
    afterSave: vi.fn(),
    now: () => NOW,
  };
  const ports: FileQuickNotePorts = { save, create, now: () => NOW };
  return { ports, rows, commits, blobs };
}

const ANA = { id: 'qn-ana', capturedAt: '2026-10-09T08:00:00.000Z', heading: '9 October 2026, 8:00 AM', text: 'Ask Ana about the lease\nbefore Friday' };
const KITE = { id: 'qn-kite', capturedAt: '2026-10-09T09:00:00.000Z', heading: '9 October 2026, 9:00 AM', text: 'Buy a kite' };
const TRIAGE_BODY = withQuickSections('', [ANA, KITE]);
const triage: Row = { id: 'tr', path: 'Quick note triage.md', title: 'Quick note triage', body: TRIAGE_BODY, blobSha: 'trb', deleted: false };
const flat: Row = { id: 't1', path: 'Home/Flat.md', title: 'Flat', body: '# Flat\n\nThe boiler is due a service.\n', blobSha: 'tb', deleted: false };

const sectionsIn = (rows: Map<string, Row>) => parseQuickSections(rows.get('Quick note triage.md')!.body).map((s) => s.id);

describe('appendQuickNote', () => {
  it('puts the text at the foot under a dated line', () => {
    expect(filedLine(NOW)).toBe('*Added 10 October 2026*');
    expect(appendQuickNote('# Flat\n\nBoiler.\n\n\n', 'Call Ana\r\n', NOW)).toBe(
      '# Flat\n\nBoiler.\n\n*Added 10 October 2026*\n\nCall Ana\n',
    );
  });

  it('starts an empty note with the dated line', () => {
    expect(appendQuickNote('', 'Call Ana', NOW)).toBe('*Added 10 October 2026*\n\nCall Ana\n');
  });
});

describe('filing a quick note into a note', () => {
  it('saves the text to the target first, then takes out that section alone', async () => {
    const { ports, rows, commits } = vault([triage, flat]);
    const result = await fileQuickNote(ports, {
      sectionId: ANA.id,
      fingerprint: quickSectionFingerprint(ANA.text),
      target: { kind: 'note', path: flat.path, blobSha: 'tb' },
    });

    expect(result).toMatchObject({ ok: true, path: flat.path, title: 'Flat', removed: true, section: { id: ANA.id, text: ANA.text } });
    expect(rows.get(flat.path)!.body).toBe(
      '# Flat\n\nThe boiler is due a service.\n\n*Added 10 October 2026*\n\nAsk Ana about the lease\nbefore Friday\n',
    );
    expect(sectionsIn(rows)).toEqual([KITE.id]);
    expect(commits).toEqual(['write Home/Flat.md: Edit Flat from Dash', 'write Quick note triage.md: Edit Quick note triage from Dash']);
  });

  it('refuses a section edited since it was shown, and changes nothing', async () => {
    const { ports, rows, commits } = vault([triage, flat]);
    const result = await fileQuickNote(ports, {
      sectionId: ANA.id,
      fingerprint: quickSectionFingerprint('Ask Ana'),
      target: { kind: 'note', path: flat.path },
    });
    expect(result).toEqual({ ok: false, reason: 'quick-changed', error: FILE_ERRORS['quick-changed'] });
    expect(commits).toEqual([]);
    expect(sectionsIn(rows)).toEqual([ANA.id, KITE.id]);
  });

  it('refuses a section that is gone, and Quick note triage as the target', async () => {
    const { ports, commits } = vault([triage, flat]);
    expect(await fileQuickNote(ports, { sectionId: 'qn-gone', target: { kind: 'own' } })).toMatchObject({ ok: false, reason: 'not-quick' });
    expect(await fileQuickNote(ports, { sectionId: ANA.id, target: { kind: 'note', path: 'Quick note triage.md' } })).toMatchObject({
      ok: false,
      reason: 'same-note',
    });
    expect(commits).toEqual([]);
  });

  it('leaves the section where it is when the target changed in Obsidian', async () => {
    const { ports, rows, commits } = vault([triage, flat]);
    const result = await fileQuickNote(ports, { sectionId: ANA.id, target: { kind: 'note', path: flat.path, blobSha: 'older' } });
    expect(result).toEqual({ ok: false, reason: 'changed', error: FILE_ERRORS.changed });
    expect(commits).toEqual([]);
    expect(sectionsIn(rows)).toEqual([ANA.id, KITE.id]);
  });

  it('says what happened when the vault cannot be written', async () => {
    const { ports, rows } = vault([triage, flat], {
      writeNote: async () => {
        throw new VaultReadOnlyError('read only');
      },
    });
    const result = await fileQuickNote(ports, { sectionId: ANA.id, target: { kind: 'note', path: flat.path } });
    expect(result).toMatchObject({ ok: false, reason: 'read-only' });
    expect(sectionsIn(rows)).toEqual([ANA.id, KITE.id]);
  });
});

describe('making a quick note a note of its own', () => {
  it('writes it at the top of the vault named from its first line, then takes out its section', async () => {
    const { ports, rows, commits } = vault([triage]);
    const result = await fileQuickNote(ports, { sectionId: ANA.id, target: { kind: 'own' } });
    expect(result).toMatchObject({ ok: true, path: 'Ask Ana about the lease.md', title: 'Ask Ana about the lease', removed: true });
    expect(rows.get('Ask Ana about the lease.md')!.body).toBe('Ask Ana about the lease\nbefore Friday\n');
    expect(sectionsIn(rows)).toEqual([KITE.id]);
    expect(commits[0]).toBe('create Ask Ana about the lease.md: Add Ask Ana about the lease from Dash');
  });

  it('takes the name the person typed', async () => {
    const { ports, rows } = vault([triage]);
    const result = await fileQuickNote(ports, { sectionId: KITE.id, target: { kind: 'own', title: 'Kites' } });
    expect(result).toMatchObject({ ok: true, path: 'Kites.md', removed: true });
    expect(rows.get('Kites.md')!.body).toBe('Buy a kite\n');
  });

  it('warns when the text is filed but the section could not be taken out', async () => {
    let writes = 0;
    const { ports, rows } = vault([triage, flat], {
      writeNote: async (path: string) => {
        writes += 1;
        if (path === 'Quick note triage.md') throw new VaultReadOnlyError('read only');
        return { blobSha: `w${writes}`, commitSha: `c${writes}` };
      },
    });
    const result = await fileQuickNote(ports, { sectionId: ANA.id, target: { kind: 'note', path: flat.path } });
    expect(result).toMatchObject({ ok: true, removed: false });
    expect(result.ok && result.warning).toMatch(/could not be taken out of Quick note triage/);
    expect(sectionsIn(rows)).toEqual([ANA.id, KITE.id]);
  });
});
