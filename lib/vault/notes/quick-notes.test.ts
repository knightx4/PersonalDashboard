import { describe, expect, it } from 'vitest';
import { fakeVaultNotes } from '../../../tests/stubs/fake-vault-notes';
import { addQuickNote, foldQuickNoteFiles, isQuickNoteFile, removeQuickSection } from '@/lib/vault/notes/quick-notes';
import {
  findQuickSection,
  parseQuickSections,
  QUICK_NOTE_INTRO,
  quickSectionFingerprint,
  quickSectionHeading,
  withoutQuickSection,
  withQuickSections,
} from '@/lib/vault/notes/quick-sections';
import { readVaultUndo, undoVaultWrite, vaultUndoRecord } from '@/lib/vault/notes/undo';
import type { VaultSource } from '@/lib/vault/providers/types';

const ME = '11111111-1111-4111-8111-111111111111';
const TRIAGE = 'Quick note triage.md';
const AT = new Date('2026-11-08T14:32:05Z');

type Row = Record<string, unknown>;

function note(id: string, path: string, body: string, blob: string, extra: Row = {}): Row {
  return { id, user_id: ME, path, title: path.replace(/\.md$/, '').split('/').pop(), body, blob_sha: blob, deleted_at: null, ...extra };
}

function setup(rows: Row[] = []) {
  const fake = fakeVaultNotes(rows, ME);
  let tick = 0;
  const ports = {
    save: fake.ports.save,
    create: fake.ports.create,
    timeZone: 'Europe/London',
    now: () => new Date(AT.getTime() + (tick += 1) * 60_000),
  };
  const triage = () => rows.find((row) => row.path === TRIAGE && row.deleted_at == null);
  return { rows, fake, ports, triage };
}

describe('the sections of Quick note triage', () => {
  const one = { id: 'qn-one', capturedAt: AT.toISOString(), heading: quickSectionHeading(AT, 'UTC'), text: 'Call Ana\n\n## Not a quick note\nstill Ana' };
  const two = { id: 'qn-two', capturedAt: AT.toISOString(), heading: 'Later', text: 'Buy a kite' };

  it('heads each with its day and time, and keeps a heading inside the text as text', () => {
    expect(one.heading).toBe('8 November 2026, 2:32 PM');
    const body = withQuickSections('', [one, two]);
    expect(body.startsWith(`${QUICK_NOTE_INTRO}\n\n## 8 November 2026, 2:32 PM\n<!-- quick-note qn-one 2026-11-08T14:32:05.000Z -->\n\nCall Ana`)).toBe(true);
    expect(parseQuickSections(body)).toEqual([
      { id: 'qn-one', capturedAt: AT.toISOString(), heading: one.heading, text: one.text },
      { id: 'qn-two', capturedAt: AT.toISOString(), heading: 'Later', text: 'Buy a kite' },
    ]);
  });

  it('takes one section out and leaves the rest, and what the person wrote above them', () => {
    const body = withQuickSections('My own line\n', [one, two]);
    const out = withoutQuickSection(body, 'qn-one')!;
    expect(out.startsWith('My own line\n\n## Later')).toBe(true);
    expect(parseQuickSections(out).map((s) => s.id)).toEqual(['qn-two']);
    expect(withoutQuickSection(body, 'qn-none')).toBeNull();
    expect(withoutQuickSection(withoutQuickSection(out, 'qn-two')!, 'qn-two')).toBeNull();
  });

  it('drops the old list Dash rebuilt from the Inbox files', () => {
    const old = 'Dash keeps this note. It lists the quick notes waiting in your Inbox and is rewritten.\n\n## [[Inbox/A|A]]\n\n> A\n';
    expect(withQuickSections(old, [two])).toBe(`${QUICK_NOTE_INTRO}\n\n${withQuickSections('', [two]).slice(QUICK_NOTE_INTRO.length + 2)}`);
  });
});

describe('addQuickNote', () => {
  it('makes Quick note triage for the first, and adds each next one at the foot', async () => {
    const { ports, triage, rows } = setup();
    const first = await addQuickNote(ports, 'Call Ana about the lease');
    const second = await addQuickNote(ports, 'Buy a kite');
    const third = await addQuickNote(ports, 'Book the dentist');
    expect(first.ok && second.ok && third.ok).toBe(true);
    // One note in the vault, three sections, no file each.
    expect(rows.filter((row) => row.deleted_at == null).map((row) => row.path)).toEqual([TRIAGE]);
    expect(parseQuickSections(String(triage()!.body)).map((s) => s.text)).toEqual([
      'Call Ana about the lease',
      'Buy a kite',
      'Book the dentist',
    ]);
    expect(first).toMatchObject({ ok: true, path: TRIAGE, title: 'Call Ana about the lease' });
  });

  it('goes again over a note another write moved on meanwhile', async () => {
    const { ports, rows, triage } = setup();
    await addQuickNote(ports, 'First');
    let raced = false;
    const racing = {
      ...ports,
      save: {
        ...ports.save,
        openSource: async () => {
          const repo = await ports.save.openSource();
          if (!raced) {
            raced = true;
            // A capture elsewhere lands between the read and the commit.
            const row = triage()!;
            Object.assign(row, { body: `${row.body}\n## Elsewhere\n<!-- quick-note qn-else -->\n\nElsewhere\n`, blob_sha: 'moved' });
          }
          return repo;
        },
      },
    };
    const result = await addQuickNote(racing, 'Second');
    expect(result.ok).toBe(true);
    expect(parseQuickSections(String(triage()!.body)).map((s) => s.text)).toEqual(['First', 'Elsewhere', 'Second']);
    expect(rows).toHaveLength(1);
  });

  it('keeps what was written in Obsidian since the last sync, and adds over it', async () => {
    const stored = withQuickSections('', [{ id: 'qn-a', capturedAt: AT.toISOString(), heading: 'A', text: 'Alpha' }]);
    const inObsidian = stored.replace('Alpha', 'Alpha, edited in Obsidian');
    const { ports, triage } = setup([note('tr', TRIAGE, stored, 'stored')]);
    const commits: string[] = [];
    const repo = {
      headCommit: async () => 'head',
      snapshot: async () => ({ entries: [{ path: TRIAGE, blobSha: 'obsidian', sizeBytes: 1 }], truncated: false, attachments: [] }),
      readBlob: async (sha: string) => (sha === 'obsidian' ? inObsidian : stored),
      writeNote: async (_path: string, text: string, expected: string) => {
        if (expected !== 'obsidian') throw new (await import('@/lib/vault/providers/types')).VaultConflictError('stale', TRIAGE);
        commits.push(text);
        return { blobSha: 'merged', commitSha: 'c1' };
      },
    } as unknown as VaultSource;
    const result = await addQuickNote({ ...ports, save: { ...ports.save, openSource: async () => repo } }, 'Beta');
    expect(result).toMatchObject({ ok: true, blobSha: 'merged' });
    expect(parseQuickSections(commits[0]).map((s) => s.text)).toEqual(['Alpha, edited in Obsidian', 'Beta']);
    expect(triage()).toMatchObject({ blob_sha: 'merged' });
  });
});

describe('removeQuickSection and its Undo', () => {
  it('takes out only the section Dash added, while its text is as written', async () => {
    const { ports, fake, triage } = setup();
    const kept = await addQuickNote(ports, 'Keep me');
    const added = await addQuickNote(ports, 'Undo me');
    if (!kept.ok || !added.ok) throw new Error('not added');
    const record = vaultUndoRecord(added.blobSha, { kind: 'section', id: added.section.id, text: added.section.text });
    const undo = readVaultUndo(record as unknown as Record<string, unknown>)!;
    expect(undo).toEqual({ kind: 'section', id: added.section.id, text: 'Undo me' });
    expect(await undoVaultWrite(fake.ports, String(triage()!.id), added.blobSha, undo)).toEqual({ ok: true });
    expect(parseQuickSections(String(triage()!.body)).map((s) => s.text)).toEqual(['Keep me']);
    // Gone already: nothing to undo.
    expect((await undoVaultWrite(fake.ports, String(triage()!.id), added.blobSha, undo)).ok).toBe(false);
  });

  it('refuses a section edited since', async () => {
    const { ports, triage } = setup();
    const added = await addQuickNote(ports, 'Original');
    if (!added.ok) throw new Error('not added');
    const row = triage()!;
    row.body = String(row.body).replace('Original', 'Changed');
    expect(await removeQuickSection(ports, added.section.id, quickSectionFingerprint('Original'))).toMatchObject({
      ok: false,
      reason: 'quick-changed',
    });
    expect(findQuickSection(String(row.body), added.section.id)).not.toBeNull();
  });
});

describe('folding the old quick-note files in', () => {
  it('knows a quick note from a note kept in the Inbox by its name', () => {
    expect(isQuickNoteFile('Inbox/Idea.md', 'Idea\nabout songs')).toBe(true);
    expect(isQuickNoteFile('Inbox/Call Ana 2.md', 'Call Ana\n')).toBe(true);
    expect(isQuickNoteFile('Inbox/Capture 2026-10-01.md', '...')).toBe(true);
    expect(isQuickNoteFile('Inbox/Board meeting 25 Oct 2026.md', '## Since last week\nThis is the first meeting')).toBe(false);
    expect(isQuickNoteFile('Inbox/Deep/Idea.md', 'Idea')).toBe(false);
    expect(isQuickNoteFile('Idea.md', 'Idea')).toBe(false);
  });

  it('puts each in as a section under the day it was written, oldest first, then takes the files out', async () => {
    const old = 'Dash keeps this note. It lists the quick notes waiting in your Inbox and is rewritten whenever one is added.\n\n## [[Inbox/Idea|Idea]]\n\n> Idea\n';
    const rows = [
      note('tr', TRIAGE, old, 'tb'),
      note('a0000000-0000-4000-8000-000000000001', 'Inbox/Buy a kite.md', 'Buy a kite\n', 'kb', { written_at: '2026-10-20T10:00:00Z' }),
      note('b0000000-0000-4000-8000-000000000002', 'Inbox/Idea.md', 'Idea\nabout songs\n', 'ib', { written_at: '2026-10-12T10:00:00Z' }),
      note('c0000000-0000-4000-8000-000000000003', 'Inbox/Board meeting.md', '## Since last week\n', 'bb', { written_at: '2026-10-13T10:00:00Z' }),
    ];
    const { ports, fake, triage } = setup(rows);
    const files = rows
      .filter((row) => String(row.path).startsWith('Inbox/'))
      .map((row) => ({ id: String(row.id), path: String(row.path), body: String(row.body), blobSha: String(row.blob_sha), writtenAt: String(row.written_at) }));

    const result = await foldQuickNoteFiles({ ...ports, remove: fake.ports.remove }, files);
    expect(result).toEqual({ folded: 2, removed: 2, failed: 0 });
    const sections = parseQuickSections(String(triage()!.body));
    expect(sections.map((s) => [s.text, s.heading])).toEqual([
      ['Idea\nabout songs', '12 October 2026, 11:00 AM'],
      ['Buy a kite', '20 October 2026, 11:00 AM'],
    ]);
    expect(String(triage()!.body).startsWith(QUICK_NOTE_INTRO)).toBe(true);
    const live = rows.filter((row) => row.deleted_at == null).map((row) => row.path);
    expect(live).toEqual([TRIAGE, 'Inbox/Board meeting.md']);

    // Again: nothing more is added, and nothing is left to remove.
    const again = await foldQuickNoteFiles({ ...ports, remove: fake.ports.remove }, files.slice(0, 2));
    expect(again.folded).toBe(0);
    expect(parseQuickSections(String(triage()!.body))).toHaveLength(2);
  });
});
