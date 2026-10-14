import { describe, expect, it } from 'vitest';
import { VAULT_CHANGE_KINDS, VAULT_FILE_KINDS } from '@/lib/ask/vault-changes';
import { MAYA_QUESTION_MAX } from '@/lib/vault/maya/thought-model';
import { readVaultUndo, undoVaultWrite } from '@/lib/vault/notes/undo';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { fakeVaultNotes } from '../../tests/stubs/fake-vault-notes';
import { QUESTION_MAX, VAULT_WRITES, runVaultWrite, type VaultMade, type VaultWriteEnv } from './vault-writes';

/**
 * The Vault writes an agent makes (plan #1894.9.3): each reads its row by id
 * and the person's user id (the connector runs them with no row level
 * security), and a note change keeps what its Undo needs to commit it back.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const SOMEONE = '00000000-0000-4000-8000-0000000000bb';
const NOTE = '11111111-1111-4111-8111-111111111111';
const QUICK = '22222222-2222-4222-8222-222222222222';
const THEME = '33333333-3333-4333-8333-333333333333';
const THREAD = '44444444-4444-4444-8444-444444444444';
const COURSE = '55555555-5555-4555-8555-555555555555';

function setup(tables: FakeTables = {}) {
  const rows = (tables['obsidian.notes'] ??= []);
  const vault = fakeVaultNotes(rows, ME);
  rows.push(vault.note(NOTE, 'Home/Flat.md', '# Flat\n\nThe boiler is due a service.\n', 'b-flat'));
  rows.push(vault.note(QUICK, 'Inbox/Call Ana.md', 'Call Ana about the lease\n', 'b-quick'));
  const db = fakeSchemaDb(tables);
  const uploads: string[] = [];
  const you = db('you');
  Object.assign(you, {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { data: { path }, error: null };
        },
        remove: async () => ({ data: [], error: null }),
      }),
    },
  });
  const env: VaultWriteEnv = { userId: ME, vault: db('obsidian'), core: db('core'), you, notes: vault.ports };
  return { env, rows, vault, uploads, tables };
}

const write = (name: string) => VAULT_WRITES.find((entry) => entry.name === name)!;

async function made(env: VaultWriteEnv, name: string, input: Record<string, unknown>): Promise<VaultMade> {
  const result = await runVaultWrite(write(name), env, input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(env: VaultWriteEnv, name: string, input: Record<string, unknown>): Promise<string> {
  const result = await runVaultWrite(write(name), env, input);
  if (!('ok' in result)) throw new Error(`${name} was not refused`);
  return result.error;
}

/** Undo a note change from what it kept, as Home's Undo does. */
async function undo(env: VaultWriteEnv, change: VaultMade) {
  const kept = readVaultUndo(change.undo);
  if (!kept) throw new Error('nothing kept');
  return undoVaultWrite(env.notes, change.subjectRef.split(':')[1], change.undo!.vault_blob_sha as string, kept);
}

describe('the Vault writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(VAULT_WRITES.map((entry) => entry.name)).toEqual([...VAULT_CHANGE_KINDS]);
    expect(QUESTION_MAX).toBe(MAYA_QUESTION_MAX);
  });

  it('writes a note in the Inbox and takes it out again', async () => {
    const { env, rows, vault } = setup();
    const change = await made(env, 'write_vault_note', { title: 'Lease', body: 'Renewal is in March.' });
    expect(change).toMatchObject({ kind: 'write_vault_note', op: 'insert', summary: 'Dash wrote the note "Lease" in the vault\'s Inbox.' });
    expect(rows.find((row) => row.path === 'Inbox/Lease.md')).toMatchObject({ body: 'Renewal is in March.\n' });
    expect(await undo(env, change)).toEqual({ ok: true });
    expect(rows.find((row) => row.path === 'Inbox/Lease.md')?.deleted_at).not.toBeNull();
    expect(vault.commits.at(-1)).toMatch(/^delete Inbox\/Lease\.md/);
  });

  it('adds to the foot of a note, and the Undo commits the old text back', async () => {
    const { env, rows } = setup();
    const change = await made(env, 'edit_vault_note', { note_ref: NOTE, append: 'Booked for 3 November.' });
    expect(change.summary).toBe('Dash added to the foot of the note "Flat".');
    expect(rows.find((row) => row.id === NOTE)?.body).toBe('# Flat\n\nThe boiler is due a service.\n\nBooked for 3 November.\n');
    expect(await undo(env, change)).toEqual({ ok: true });
    expect(rows.find((row) => row.id === NOTE)?.body).toBe('# Flat\n\nThe boiler is due a service.\n');
  });

  it('refuses an Undo once the note has moved on', async () => {
    const { env, rows } = setup();
    const change = await made(env, 'edit_vault_note', { note_ref: NOTE, body: '# Flat\n\nSold.\n' });
    rows.find((row) => row.id === NOTE)!.blob_sha = 'b-later';
    expect(await undo(env, change)).toEqual({ ok: false, error: 'It has changed since Dash wrote it, so undoing would lose the later change.' });
  });

  it('renames a note and back', async () => {
    const { env, rows } = setup();
    const change = await made(env, 'rename_vault_note', { note_ref: NOTE, name: 'Apartment' });
    expect(change.summary).toBe('Dash renamed the note "Flat" to "Apartment".');
    expect(rows.find((row) => row.id === NOTE)?.path).toBe('Home/Apartment.md');
    expect(await undo(env, change)).toEqual({ ok: true });
    expect(rows.find((row) => row.id === NOTE)?.path).toBe('Home/Flat.md');
  });

  it('files a quick note into a note, and the Undo puts both back', async () => {
    const { env, rows } = setup();
    const change = await made(env, 'file_quick_note', { quick_note_ref: QUICK, into_note_ref: NOTE });
    expect(change).toMatchObject({ op: 'update', subjectRef: `obsidian.notes:${NOTE}` });
    expect(rows.find((row) => row.id === NOTE)?.body).toContain('Call Ana about the lease');
    expect(rows.find((row) => row.id === QUICK)?.deleted_at).not.toBeNull();

    expect(await undo(env, change)).toEqual({ ok: true });
    expect(rows.find((row) => row.id === NOTE)?.body).toBe('# Flat\n\nThe boiler is due a service.\n');
    expect(rows.find((row) => row.path === 'Inbox/Call Ana.md')).toMatchObject({ deleted_at: null, body: 'Call Ana about the lease\n' });
  });

  it('makes a quick note a note of its own, and the Undo takes it back to the Inbox', async () => {
    const { env, rows } = setup();
    const change = await made(env, 'file_quick_note', { quick_note_ref: QUICK });
    expect(change.op).toBe('insert');
    const own = rows.find((row) => row.path === 'Call Ana about the lease.md');
    expect(own?.deleted_at).toBeNull();
    expect(await undo(env, change)).toEqual({ ok: true });
    expect(own?.deleted_at).not.toBeNull();
    expect(rows.find((row) => row.path === 'Inbox/Call Ana.md')?.deleted_at).toBeNull();
  });

  it('refuses a note that is not theirs, and a note outside the Inbox as a quick note', async () => {
    const { env, rows } = setup();
    rows.find((row) => row.id === NOTE)!.user_id = SOMEONE;
    expect(await refused(env, 'edit_vault_note', { note_ref: NOTE, append: 'x' })).toMatch(/no note of theirs/);
    rows.find((row) => row.id === NOTE)!.user_id = ME;
    expect(await refused(env, 'file_quick_note', { quick_note_ref: NOTE })).toMatch(/not a quick note/);
  });

  it('renames a theme by its name, and refuses one that is not on the map', async () => {
    const { env } = setup({
      'obsidian.themes': [{ id: THEME, user_id: ME, name: 'Housing', about: null }],
    });
    const change = await made(env, 'rename_theme', { theme: 'housing', name: 'Home' });
    expect(change).toMatchObject({ subjectRef: `obsidian.themes:${THEME}`, before: { name: 'Housing' }, after: { name: 'Home' }, undo: null });
    expect(await refused(env, 'rename_theme', { theme: 'Work', name: 'Jobs' })).toMatch(/No theme/);
  });

  it('rewrites a Maya question found by its note', async () => {
    const { env } = setup({
      'core.conversations': [{ id: THREAD, user_id: ME, voice: 'maya', subject_ref: `obsidian.notes:${NOTE}`, title: 'Is the boiler worth it?' }],
    });
    const change = await made(env, 'rename_maya_question', { note_ref: NOTE, question: '  When to   replace the boiler?' });
    expect(change).toMatchObject({ subjectRef: `core.conversations:${THREAD}`, after: { title: 'When to replace the boiler?' } });
  });

  it('corrects only the course fields given', async () => {
    const { env } = setup({
      'you.courses': [{ id: COURSE, user_id: ME, school: 'Leeds', code: 'CS1', title: 'Programming', term: 'Fall', year: 2019, credits: 3, grade: 'B' }],
    });
    const change = await made(env, 'change_course', { course_ref: COURSE, grade: 'A-', term: '' });
    expect(change.after).toMatchObject({ grade: 'A-', term: null, title: 'Programming', year: 2019, credits: 3 });
    expect(await refused(env, 'change_course', { course_ref: COURSE })).toMatch(/Say what to change/);
  });

  it('keeps a transcript from its text with its courses', async () => {
    const { env, uploads, tables } = setup();
    const change = await made(env, 'save_transcript', {
      school: 'Leeds',
      text: 'CS1 Programming A',
      courses: [{ code: 'CS1', title: 'Programming', grade: 'A', year: 2019 }],
    });
    expect(change).toMatchObject({ kind: 'save_transcript', op: 'insert', summary: 'Dash kept a transcript from Leeds with 1 course on Work & school.' });
    expect(uploads[0]).toMatch(new RegExp(`^${ME}/`));
    expect(tables['you.courses']).toEqual([expect.objectContaining({ title: 'Programming', school: 'Leeds', position: 0 })]);
  });

  it('marks the note kinds as the ones whose Undo is a commit', () => {
    expect(VAULT_FILE_KINDS).toEqual(['write_vault_note', 'edit_vault_note', 'rename_vault_note', 'file_quick_note']);
  });
});
