import { sameAs, type DashWriteRuns } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { isUuid, type AskRow, type SchemaClient } from '@/lib/ask/db';
import type { VaultChangeInput, VaultChangeKind } from '@/lib/ask/vault-changes';
import { toRef } from '@/lib/core/refs';
import type { ModuleId } from '@/lib/modules';
import { noteCreatePorts, noteRemovePorts, noteRenamePorts, noteSavePorts } from '@/lib/vault/db/ports';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { createCapturedNote } from '@/lib/vault/notes/create';
import { fileQuickNote, isInInbox } from '@/lib/vault/notes/file';
import { renameNote } from '@/lib/vault/notes/rename';
import { saveNote, type SaveNoteFailure } from '@/lib/vault/notes/save';
import { vaultUndoRecord, type VaultUndo, type VaultUndoPorts } from '@/lib/vault/notes/undo';
import { renameThemeRow, themeNameProblem } from '@/lib/vault/map/rename-theme';
import { renameQuestion } from '@/lib/vault/maya/store';
import { basenameOf, isTriageNotePath, mayaThreadHref, noteHref } from '@/lib/vault/paths';
import { COURSE_FIELD_NAMES, EDUCATION_HREF, parseCourse, schoolField } from '@/lib/you/education';
import { saveTranscriptWithCourses, updateCourse } from '@/lib/you/transcript-store';
import { TRANSCRIPTS_BUCKET, transcriptStoragePath } from '@/lib/you/transcripts';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The Vault changes an agent makes when asked, and correcting a course on
 * Work & school (plan #1894.9.3, feature #1894):
 *
 *   write_vault_note      a new note in the Inbox, named by its title.
 *   edit_vault_note       a note's text replaced, or added to at its foot.
 *   rename_vault_note     a note's file renamed in its folder.
 *   file_quick_note       a quick note filed into a note, or made one of its own.
 *   rename_theme          a theme on the map renamed.
 *   rename_maya_question  the line a thread with Maya is about, rewritten.
 *   change_course         a saved course corrected.
 *   save_transcript       a transcript kept from its text, with its courses.
 *
 * Each names one row as its subject (#1894.4: an agent's writes go straight
 * in, each listed on Home with an Undo). A theme, a Maya thread and a course
 * are rows, so the one undo rule in lib/core/dash-actions.ts puts them back
 * from the values kept. A note is a file in the notes repository, so the four
 * note writes commit through the same code the note page, the New note box
 * and triage use, and keep in `undo` what lib/vault/notes/undo.ts needs to
 * commit it back: the blob the note was left at, and the old body, the old
 * name or the quick note that was filed. Home's Undo takes it back as
 * add_quick_note's is (undoVaultCapture in lib/capture/vault.ts).
 *
 * Both Ask and the connector run them, as News's (lib/dash/news-writes.ts):
 * Ask on the person's own clients, the connector on service-role ones for the
 * verified person. The service role passes no row level security, so every
 * row is read by its id and the person's user id here, and the note ports are
 * made with the user id too, so each of their reads and writes names them.
 *
 * A note an agent writes is embedded by the next sync, not straight after the
 * write as the page does, and Quick note triage's own note is rebuilt the next
 * time a quick note is added or filed on the page.
 */

export type VaultWriteEnv = {
  userId: string;
  /** The obsidian schema's client. */
  vault: SchemaClient;
  core: SchemaClient;
  you: SchemaClient;
  /** The note ports, scoped to the person (vaultNotePorts); a fake in tests. */
  notes: VaultUndoPorts;
};

/** A Vault change as made, before a surface keeps it. */
export type VaultMade = {
  kind: VaultChangeKind;
  input: VaultChangeInput;
  subjectRef: string;
  op: 'insert' | 'update';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: string;
  /** What the record keeps for a note's Undo; null for a row the generic rule undoes. */
  undo: Record<string, unknown> | null;
  row: AskRow;
};

export type VaultWrite = {
  name: VaultChangeKind;
  /** The buttons it does the same as, or why none does (./runs.ts). */
  runs: DashWriteRuns;
  /** The workspaces that must be switched on for the change. */
  modules: readonly ModuleId[];
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: VaultWriteEnv, args: Args) => Promise<VaultMade>;
};

/** A refusal the model reads and says in words. */
export class VaultRefused extends Error {}

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

/** The note ports a write and its Undo use, on one client, naming the person on every query. */
export function vaultNotePorts(vault: SchemaClient, userId: string): VaultUndoPorts {
  const supabase = vault as unknown as VaultSupabaseClient;
  const afterSave = () => {};
  return {
    remove: noteRemovePorts(supabase, userId),
    save: noteSavePorts({ supabase, userId, afterSave }),
    rename: noteRenamePorts(supabase, userId),
    create: noteCreatePorts({ supabase, userId, afterSave }),
  };
}

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function idOf(args: Args, key: string, what: string): string {
  const id = text(args, key);
  if (!id) throw new VaultRefused(`${key} is missing: give the ${what}'s ref from a lookup.`);
  if (!isUuid(id)) throw new VaultRefused(`${key} must be a ${what}'s ref, as a lookup returned it.`);
  return id;
}

/** A name cut to a line for a sentence. */
function named(title: unknown, fallback: string): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

const NOTE_COLUMNS = 'id, user_id, path, title, body, blob_sha, deleted_at, created_at, updated_at';

async function ownRow(
  client: SchemaClient,
  table: string,
  id: string,
  userId: string,
  what: string,
  columns = '*',
): Promise<Row> {
  const { data, error } = await client.from(table).select(columns).eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Reading the ${what} failed: ${error.message}`);
  if (!data) throw new VaultRefused(`There is no ${what} of theirs with that ref. Look it up first.`);
  return data as unknown as Row;
}

/** A note of theirs that is still in the vault, by its ref. */
async function ownNote(env: VaultWriteEnv, id: string): Promise<Row> {
  const note = await ownRow(env.vault, 'notes', id, env.userId, 'note', NOTE_COLUMNS);
  if (note.deleted_at != null) throw new VaultRefused('That note is not in the vault any more.');
  return note;
}

async function noteAt(env: VaultWriteEnv, path: string): Promise<Row> {
  const { data, error } = await env.vault
    .from('notes')
    .select(NOTE_COLUMNS)
    .eq('path', path)
    .eq('user_id', env.userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) throw new Error(`Reading ${path} after writing it failed: ${error?.message ?? 'no row'}`);
  return data as unknown as Row;
}

/** What the person reads when a note cannot be saved. Nothing has changed in any of them. */
const SAVE_REFUSALS: Record<SaveNoteFailure, string> = {
  'not-found': 'That note is not in the vault any more.',
  changed: 'That note changed since Dash read it, perhaps in Obsidian. Read it again after the next sync.',
  'read-only': 'Their vault token can read notes but not write them. They can add one that can write in vault settings.',
  reconnect: 'Their vault needs reconnecting before notes can be written. They can do that in vault settings.',
  'too-large': 'That would make the note too long to keep.',
  error: 'The note could not be saved. Tell them nothing was changed.',
};

const noteRow = (note: Row, title: string): AskRow => ({
  table: 'obsidian.notes',
  ref: note.id as string,
  title,
  href: noteHref(note.path as string),
});

/** A note change, as made, with the undo its record keeps. */
function noteMade(
  kind: VaultChangeKind,
  op: 'insert' | 'update',
  note: Row,
  before: Row | null,
  undo: VaultUndo,
  sentence: { verb: string; what: string; rest: string; summary: string },
  paths: string[] = [],
): VaultMade {
  const href = noteHref(note.path as string);
  return {
    kind,
    input: { verb: sentence.verb, what: sentence.what, rest: sentence.rest, href, where: 'Open the note', paths: ['/vault', href, ...paths] },
    subjectRef: toRef('obsidian.notes', note.id as string),
    op,
    before,
    after: note,
    summary: sentence.summary,
    undo: vaultUndoRecord(note.blob_sha as string, undo) as unknown as Record<string, unknown>,
    row: noteRow(note, sentence.what),
  };
}

// ---------------------------------------------------------------------------
// write_vault_note
// ---------------------------------------------------------------------------

async function writeVaultNote(env: VaultWriteEnv, args: Args): Promise<VaultMade> {
  const title = text(args, 'title');
  const body = text(args, 'body');
  if (!title && !body) throw new VaultRefused('Give the note a title or some text.');
  const created = await createCapturedNote(env.notes.create, body || title, title || undefined);
  if (!created.ok) throw new VaultRefused(created.error);
  const note = await noteAt(env, created.path);
  const what = named(created.title, 'a note');
  return noteMade('write_vault_note', 'insert', note, null, { kind: 'remove' }, {
    verb: 'Wrote',
    what,
    rest: ' in your Inbox',
    summary: `Dash wrote the note "${what}" in the vault's Inbox.`,
  }, ['/vault/triage']);
}

// ---------------------------------------------------------------------------
// edit_vault_note
// ---------------------------------------------------------------------------

/** The body with `addition` at its foot, after one blank line. */
export function appendToBody(body: string, addition: string): string {
  const head = body.replace(/\s+$/, '');
  const tail = `${addition.replace(/\r\n/g, '\n').trim()}\n`;
  return head ? `${head}\n\n${tail}` : tail;
}

async function editVaultNote(env: VaultWriteEnv, args: Args): Promise<VaultMade> {
  const before = await ownNote(env, idOf(args, 'note_ref', 'note'));
  const path = before.path as string;
  if (isTriageNotePath(path)) throw new VaultRefused('Quick note triage is rewritten by the app, so it is not edited by hand.');
  const replace = typeof args.body === 'string' ? (args.body as string) : null;
  const append = text(args, 'append');
  if ((replace === null) === !append) throw new VaultRefused('Give body to replace the note\'s text, or append to add to its foot, not both.');
  const oldBody = before.body as string;
  const next = replace ?? appendToBody(oldBody, append);

  const saved = await saveNote(env.notes.save, { path, text: next, expectedBlobSha: before.blob_sha as string });
  if (!saved.ok) throw new VaultRefused(SAVE_REFUSALS[saved.reason]);
  if (saved.commitSha === null) throw new VaultRefused('The note says that already, so nothing was changed.');

  const note = await noteAt(env, path);
  const what = named(note.title, basenameOf(path));
  const added = replace === null;
  return noteMade('edit_vault_note', 'update', note, before, { kind: 'restore', body: oldBody }, {
    verb: added ? 'Added to' : 'Edited',
    what,
    rest: added ? ' at its foot' : '',
    summary: added ? `Dash added to the foot of the note "${what}".` : `Dash edited the note "${what}".`,
  });
}

// ---------------------------------------------------------------------------
// rename_vault_note
// ---------------------------------------------------------------------------

async function renameVaultNote(env: VaultWriteEnv, args: Args): Promise<VaultMade> {
  const before = await ownNote(env, idOf(args, 'note_ref', 'note'));
  const name = text(args, 'name');
  const oldPath = before.path as string;
  const renamed = await renameNote(env.notes.rename, { path: oldPath, name, expectedBlobSha: before.blob_sha as string });
  if (!renamed.ok) throw new VaultRefused(renamed.error);
  const note = await noteAt(env, renamed.path);
  const from = basenameOf(oldPath);
  const to = basenameOf(renamed.path);
  return noteMade('rename_vault_note', 'update', note, before, { kind: 'rename', name: from }, {
    verb: 'Renamed',
    what: to,
    rest: `, which was ${from}`,
    summary: `Dash renamed the note "${from}" to "${to}".`,
  }, [noteHref(oldPath)]);
}

// ---------------------------------------------------------------------------
// file_quick_note
// ---------------------------------------------------------------------------

async function fileQuickNoteTool(env: VaultWriteEnv, args: Args): Promise<VaultMade> {
  const quick = await ownNote(env, idOf(args, 'quick_note_ref', 'quick note'));
  const quickPath = quick.path as string;
  if (!isInInbox(quickPath)) throw new VaultRefused('That note is not a quick note: it is not in the Inbox folder.');
  const into = text(args, 'into_note_ref') ? await ownNote(env, idOf(args, 'into_note_ref', 'note')) : null;
  if (into && isTriageNotePath(into.path as string)) throw new VaultRefused('Quick note triage is rewritten by the app, so nothing is filed into it.');

  const filed = await fileQuickNote(
    { save: env.notes.save, create: env.notes.create, remove: env.notes.remove },
    {
      quickPath,
      quickBlobSha: quick.blob_sha as string,
      target: into ? { kind: 'note', path: into.path as string, blobSha: into.blob_sha as string } : { kind: 'own' },
    },
  );
  if (!filed.ok) throw new VaultRefused(filed.error);

  const note = await noteAt(env, filed.path);
  const what = named(filed.title, basenameOf(filed.path));
  const quickText = quick.body as string;
  const body = into ? (into.body as string) : null;
  // A quick note still in the Inbox is not written back by the Undo, which would meet it there.
  const undo: VaultUndo = filed.removed
    ? { kind: 'unfile', body, quick: { path: quickPath, text: quickText } }
    : body === null
      ? { kind: 'remove' }
      : { kind: 'restore', body };
  const quickName = named(quick.title, basenameOf(quickPath));
  const made = noteMade('file_quick_note', into ? 'update' : 'insert', note, into, undo, {
    verb: 'Filed',
    what,
    rest: into ? `, adding the quick note "${quickName}"` : ' from a quick note, as a note of its own',
    summary: into
      ? `Dash filed the quick note "${quickName}" into the note "${what}".`
      : `Dash made the quick note "${quickName}" a note of its own, "${what}".`,
  }, ['/vault/triage', noteHref(quickPath)]);
  return filed.warning ? { ...made, summary: `${made.summary} ${filed.warning}` } : made;
}

// ---------------------------------------------------------------------------
// rename_theme
// ---------------------------------------------------------------------------

const THEME_COLUMNS = 'id, user_id, name, about, created_at, updated_at';

async function renameTheme(env: VaultWriteEnv, args: Args): Promise<VaultMade> {
  const name = text(args, 'name');
  const problem = themeNameProblem(name);
  if (problem) throw new VaultRefused(problem);

  let before: Row;
  if (text(args, 'theme_ref')) {
    before = await ownRow(env.vault, 'themes', idOf(args, 'theme_ref', 'theme'), env.userId, 'theme', THEME_COLUMNS);
  } else {
    const current = text(args, 'theme');
    if (!current) throw new VaultRefused('Name the theme: theme_ref, or theme with its name as it is now.');
    const { data, error } = await env.vault.from('themes').select(THEME_COLUMNS).eq('user_id', env.userId).ilike('name', current.replace(/[%_\\]/g, (c) => `\\${c}`));
    if (error) throw new Error(`Reading the themes failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length !== 1) throw new VaultRefused(`No theme on their map is called "${current}". Check its name on the map.`);
    before = rows[0];
  }
  if (before.name === name) throw new VaultRefused('That is its name already.');

  const id = before.id as string;
  const renamed = await renameThemeRow(env.vault, env.userId, id, name, THEME_COLUMNS);
  if (!renamed.ok) {
    if (renamed.reason === 'taken') throw new VaultRefused('Another theme already has that name.');
    if (renamed.reason === 'missing') throw new VaultRefused('That theme is no longer in the map.');
    throw new Error(`Renaming the theme failed: ${renamed.message}`);
  }
  const data = renamed.row;

  const href = `/vault/map/${id}`;
  const from = named(before.name, 'the theme');
  return {
    kind: 'rename_theme',
    input: { verb: 'Renamed', what: name, rest: `, the theme that was ${from}`, href, where: 'Open the theme', paths: ['/vault/map', href] },
    subjectRef: toRef('obsidian.themes', id),
    op: 'update',
    before,
    after: data as unknown as Row,
    summary: `Dash renamed the theme "${from}" to "${name}" on the vault map.`,
    undo: null,
    row: { table: 'obsidian.themes', ref: id, title: name, href },
  };
}

// ---------------------------------------------------------------------------
// rename_maya_question
// ---------------------------------------------------------------------------

/** MAYA_QUESTION_MAX in lib/vault/maya/thought-model.ts, which imports the loop and so cannot be imported here. */
export const QUESTION_MAX = 200;

const THREAD_COLUMNS = 'id, user_id, title, subject_ref, voice, created_at, updated_at';

async function renameMayaQuestion(env: VaultWriteEnv, args: Args): Promise<VaultMade> {
  const question = text(args, 'question').replace(/\s+/g, ' ');
  if (!question) throw new VaultRefused('The question cannot be blank.');
  if (question.length > QUESTION_MAX) throw new VaultRefused(`The question can be at most ${QUESTION_MAX} characters.`);

  let query = env.core.from('conversations').select(THREAD_COLUMNS).eq('user_id', env.userId).eq('voice', 'maya');
  if (text(args, 'thread_ref')) query = query.eq('id', idOf(args, 'thread_ref', 'thread'));
  else if (text(args, 'note_ref')) query = query.eq('subject_ref', toRef('obsidian.notes', idOf(args, 'note_ref', 'note')));
  else throw new VaultRefused('Name the thread: thread_ref, or note_ref for the note it is about.');
  const { data: found, error: readError } = await query.maybeSingle();
  if (readError) throw new Error(`Reading the thread failed: ${readError.message}`);
  if (!found) throw new VaultRefused('There is no thread with Maya of theirs there. Look it up first.');
  const before = found as unknown as Row;
  if (before.title === question) throw new VaultRefused('The thread is about that already.');

  const id = before.id as string;
  const data = await renameQuestion(env.core, env.userId, id, question, THREAD_COLUMNS);
  if (!data) throw new VaultRefused('That thread with Maya is not there any more.');

  const href = mayaThreadHref(id);
  return {
    kind: 'rename_maya_question',
    input: { verb: 'Rewrote', what: question, rest: ', the question a thread with Maya is about', href, where: 'Open the thread', paths: ['/vault/maya', href] },
    subjectRef: toRef('core.conversations', id),
    op: 'update',
    before,
    after: data as unknown as Row,
    summary: `Dash rewrote the question of a thread with Maya to "${named(question, 'the question')}".`,
    undo: null,
    row: { table: 'core.conversations', ref: id, title: question, href },
  };
}

// ---------------------------------------------------------------------------
// change_course
// ---------------------------------------------------------------------------

async function changeCourse(env: VaultWriteEnv, args: Args): Promise<VaultMade> {
  const id = idOf(args, 'course_ref', 'course');
  const before = await ownRow(env.you, 'courses', id, env.userId, 'course');
  const given = COURSE_FIELD_NAMES.filter((field) => args[field] !== undefined);
  if (given.length === 0) throw new VaultRefused('Say what to change: school, code, title, term, year, credits or grade.');

  const field = (name: (typeof COURSE_FIELD_NAMES)[number]): string => {
    const value = args[name] !== undefined ? args[name] : before[name];
    return value === null || value === undefined ? '' : String(value);
  };
  const read = parseCourse(field, before.school as string);
  if (!read.ok) throw new VaultRefused(read.field ? `${read.field}: ${read.error}` : read.error);

  const data = await updateCourse(env.you, env.userId, id, read.course);
  if (!data) throw new VaultRefused('That course is not there any more. Nothing was changed.');

  const title = named(read.course.title, 'the course');
  return {
    kind: 'change_course',
    input: { verb: 'Corrected', what: title, rest: ' on Work & school', href: EDUCATION_HREF, where: 'Open Work & school', paths: [EDUCATION_HREF] },
    subjectRef: toRef('you.courses', id),
    op: 'update',
    before,
    after: data as Row,
    summary: `Dash corrected the course "${title}" on Work & school.`,
    undo: null,
    row: { table: 'you.courses', ref: id, title, href: EDUCATION_HREF },
  };
}

// ---------------------------------------------------------------------------
// save_transcript
// ---------------------------------------------------------------------------

/** Most courses one transcript keeps from an agent. */
const COURSES_MAX = 100;
/** Longest transcript text kept as its file. */
const TRANSCRIPT_TEXT_MAX = 200_000;

/**
 * A transcript from its text, as the page keeps pasted text: the text as a
 * .txt file in the person's folder of the transcripts bucket, the transcript
 * row pointing at it, and the courses on it. The Undo is the generic rule's
 * on the transcript, which takes its courses with it; the file stays in the
 * bucket, which nothing lists.
 */
async function saveTranscript(env: VaultWriteEnv, args: Args): Promise<VaultMade> {
  const school = schoolField.safeParse(text(args, 'school'));
  if (!school.success) throw new VaultRefused(school.error.issues[0]?.message ?? 'Say which school this is from.');
  const body = typeof args.text === 'string' ? args.text.trim() : '';
  if (!body) throw new VaultRefused('Give the transcript\'s text as they gave it, which is kept as its original.');
  if (body.length > TRANSCRIPT_TEXT_MAX) throw new VaultRefused('That transcript is too long to keep from here.');
  const raw = Array.isArray(args.courses) ? args.courses : [];
  if (raw.length === 0) throw new VaultRefused('List at least one course on the transcript.');
  if (raw.length > COURSES_MAX) throw new VaultRefused(`A transcript takes at most ${COURSES_MAX} courses from here.`);

  const courses = raw.map((entry, index) => {
    const course = entry && typeof entry === 'object' ? (entry as Args) : {};
    const read = parseCourse((field) => {
      const value = course[field];
      return value === null || value === undefined ? '' : String(value);
    }, school.data);
    if (!read.ok) throw new VaultRefused(`courses[${index}]${read.field ? `.${read.field}` : ''}: ${read.error}`);
    return read.course;
  });

  const id = crypto.randomUUID();
  const fileName = `${school.data.replace(/[^A-Za-z0-9 ._-]+/g, ' ').trim().slice(0, 200) || 'Transcript'} transcript.txt`;
  const path = transcriptStoragePath(env.userId, fileName, id);
  const bytes = new TextEncoder().encode(`${body}\n`);
  const { error: uploadError } = await env.you.storage
    .from(TRANSCRIPTS_BUCKET)
    .upload(path, bytes, { contentType: 'text/plain', upsert: false });
  if (uploadError) throw new Error(`Keeping the transcript's text failed: ${uploadError.message}`);

  // The page's own write: the transcript, then its courses, and a refused
  // course list takes the transcript back out. The file is ours to remove.
  const saved = await saveTranscriptWithCourses(
    env.you,
    env.userId,
    { id, school: school.data, fileName, storagePath: path, mimeType: 'text/plain', sizeBytes: bytes.byteLength },
    courses,
  );
  if (!saved.ok) {
    await env.you.storage.from(TRANSCRIPTS_BUCKET).remove([path]);
    throw new Error(`Saving the ${saved.failed === 'courses' ? 'courses' : 'transcript'} failed: ${saved.message}`);
  }
  const transcript = saved.transcript;

  const count = `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}`;
  return {
    kind: 'save_transcript',
    input: { verb: 'Kept', what: `the ${school.data} transcript`, rest: `, with ${count}`, href: EDUCATION_HREF, where: 'Open Work & school', paths: [EDUCATION_HREF] },
    subjectRef: toRef('you.transcripts', id),
    op: 'insert',
    before: null,
    after: transcript as Row,
    summary: `Dash kept a transcript from ${school.data} with ${count} on Work & school.`,
    undo: null,
    row: { table: 'you.transcripts', ref: id, title: `${school.data} transcript`, href: EDUCATION_HREF },
  };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const NOTE_REF = { type: 'string', description: 'The obsidian.notes ref a lookup returned for the note.' } as const;
const COURSE_TEXT = (what: string) => ({ type: 'string', description: `${what}. An empty string clears it.` }) as const;

export const VAULT_WRITES: readonly VaultWrite[] = [
  {
    name: 'write_vault_note',
    runs: sameAs(
      ['app/vault/actions.ts#newVaultNote', 'lib/vault/notes/create.ts#createCapturedNote'],
      ['app/vault/actions.ts#openDailyNote', 'lib/vault/notes/create.ts#createCapturedNote'],
    ),
    modules: ['vault'],
    description:
      'Write a new note in their vault, when they ask for a note with a title or more than a quick thought. It goes into the Inbox folder, named by its title, and reaches Obsidian on its next pull. A quick thought to sort later is add_quick_note.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The note\'s name, which becomes its file name.' },
        body: { type: 'string', description: 'The note\'s text, in Markdown, as they gave it.' },
      },
      additionalProperties: false,
    },
    run: writeVaultNote,
  },
  {
    name: 'edit_vault_note',
    runs: sameAs(
      ['app/vault/n/[...path]/actions.ts#saveNoteEdit', 'lib/vault/notes/save.ts#saveNote'],
      ['app/learn/e/[id]/notes-to-vault-actions.ts#addEssayNotesToVaultNote', 'lib/vault/notes/save.ts#saveNote'],
    ),
    modules: ['vault'],
    description:
      'Change the text of one of their vault notes, when they ask. Give append to add text at the note\'s foot, or body to replace the whole text (without the frontmatter, which is kept as it is). Name the note by the obsidian.notes ref a lookup returned. A note changed in Obsidian since the last sync is refused.',
    input_schema: {
      type: 'object',
      properties: {
        note_ref: NOTE_REF,
        append: { type: 'string', description: 'Text to add at the foot of the note, after a blank line.' },
        body: { type: 'string', description: 'Instead of append: the note\'s whole new text, in Markdown.' },
      },
      required: ['note_ref'],
      additionalProperties: false,
    },
    run: editVaultNote,
  },
  {
    name: 'rename_vault_note',
    runs: sameAs(['app/vault/n/[...path]/actions.ts#renameNoteAction', 'lib/vault/notes/rename.ts#renameNote']),
    modules: ['vault'],
    description:
      'Rename one of their vault notes, when they ask. Its file moves to the new name in the same folder; links to the old name in other notes are left as they are. Name the note by the obsidian.notes ref a lookup returned.',
    input_schema: {
      type: 'object',
      properties: {
        note_ref: NOTE_REF,
        name: { type: 'string', description: 'The new name, without .md.' },
      },
      required: ['note_ref', 'name'],
      additionalProperties: false,
    },
    run: renameVaultNote,
  },
  {
    name: 'file_quick_note',
    runs: sameAs(['app/vault/triage/actions.ts#fileQuickNoteAction', 'lib/vault/notes/file.ts#fileQuickNote']),
    modules: ['vault'],
    description:
      'File one of their quick notes out of the Inbox, when they ask: into another note, where its text is added at the foot under the day\'s date, or as a note of its own at the top of the vault when into_note_ref is left out. Name both by the obsidian.notes refs a lookup returned.',
    input_schema: {
      type: 'object',
      properties: {
        quick_note_ref: { type: 'string', description: 'The obsidian.notes ref of the quick note, in the Inbox folder.' },
        into_note_ref: { type: 'string', description: 'The obsidian.notes ref of the note to add it to. Left out, it becomes a note of its own.' },
      },
      required: ['quick_note_ref'],
      additionalProperties: false,
    },
    run: fileQuickNoteTool,
  },
  {
    name: 'rename_theme',
    runs: sameAs(['app/vault/map/actions.ts#renameTheme', 'lib/vault/map/rename-theme.ts#renameThemeRow']),
    modules: ['vault'],
    description:
      'Rename a theme on their vault map, when they ask. Name it by theme_ref, or by theme with its name as it is now. Names are unique on the map, ignoring case.',
    input_schema: {
      type: 'object',
      properties: {
        theme_ref: { type: 'string', description: 'The obsidian.themes ref, when one was given.' },
        theme: { type: 'string', description: 'Instead of theme_ref: the theme\'s name as it is now.' },
        name: { type: 'string', description: 'The new name.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    run: renameTheme,
  },
  {
    name: 'rename_maya_question',
    runs: sameAs(['app/vault/maya/actions.ts#renameMayaQuestion', 'lib/vault/maya/store.ts#renameQuestion']),
    modules: ['vault'],
    description: `Rewrite the question a thread with Maya is about, when they ask. Name the thread by thread_ref, or by note_ref for the note it is about. At most ${QUESTION_MAX} characters.`,
    input_schema: {
      type: 'object',
      properties: {
        thread_ref: { type: 'string', description: 'The core.conversations ref of the thread with Maya.' },
        note_ref: { type: 'string', description: 'Instead of thread_ref: the obsidian.notes ref of the note the thread is about.' },
        question: { type: 'string', description: 'The new question, in a line.' },
      },
      required: ['question'],
      additionalProperties: false,
    },
    run: renameMayaQuestion,
  },
  {
    name: 'change_course',
    runs: sameAs(['app/you/work/actions.ts#updateCourseAction', 'lib/you/transcript-store.ts#updateCourse']),
    modules: ['you'],
    description:
      'Correct a saved course on their Work & school tab, when they ask. Name it by the you.courses ref the courses lookup returned, and give only the fields that change.',
    input_schema: {
      type: 'object',
      properties: {
        course_ref: { type: 'string', description: 'The you.courses ref the courses lookup returned.' },
        school: { type: 'string', description: 'The school. Left empty, the transcript\'s.' },
        code: COURSE_TEXT('The course code, such as "CS 101"'),
        title: { type: 'string', description: 'The course title.' },
        term: COURSE_TEXT('The term, such as "Fall"'),
        year: { type: ['integer', 'string'], description: 'The year, such as 2019. An empty string clears it.' },
        credits: { type: ['number', 'string'], description: 'The credits, such as 3 or 4.5. An empty string clears it.' },
        grade: COURSE_TEXT('The grade, such as "A-"'),
      },
      required: ['course_ref'],
      additionalProperties: false,
    },
    run: changeCourse,
  },
  {
    name: 'save_transcript',
    runs: sameAs(['app/you/work/actions.ts#saveTranscriptAction', 'lib/you/transcript-store.ts#saveTranscriptWithCourses']),
    modules: ['you'],
    description:
      'Keep an academic transcript on their Work & school tab from its text, when they give you one and ask to save it. Pass the school, the transcript\'s text as they gave it (kept as its original), and every course on it, each with its title and whatever of code, term, year, credits and grade it shows. A course from another school names its own.',
    input_schema: {
      type: 'object',
      properties: {
        school: { type: 'string', description: 'The school the transcript is from.' },
        text: { type: 'string', description: 'The transcript as they gave it, word for word.' },
        courses: {
          type: 'array',
          minItems: 1,
          maxItems: COURSES_MAX,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              code: { type: 'string' },
              term: { type: 'string' },
              year: { type: ['integer', 'string'] },
              credits: { type: ['number', 'string'] },
              grade: { type: 'string' },
              school: { type: 'string', description: 'Only when it differs from the transcript\'s.' },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
      },
      required: ['school', 'text', 'courses'],
      additionalProperties: false,
    },
    run: saveTranscript,
  },
];

/** Runs one Vault write. Never throws: a refusal or a failure is the sentence the model reads. */
export async function runVaultWrite(
  write: VaultWrite,
  env: VaultWriteEnv,
  input: unknown,
): Promise<VaultMade | { ok: false; error: string }> {
  const args = input && typeof input === 'object' ? (input as Args) : {};
  try {
    return await write.run(env, args);
  } catch (error) {
    if (error instanceof VaultRefused) return { ok: false, error: error.message };
    console.error(`vault write ${write.name} failed`, error);
    return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
  }
}

/** The first workspace the change needs that the person has switched off, or null. */
export function vaultSwitchedOff(write: VaultWrite, enabled: readonly string[]): ModuleId | null {
  return write.modules.find((module) => !enabled.includes(module)) ?? null;
}

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The Vault writes as Ask's write tools, run on the person's own clients. */
export const VAULT_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = VAULT_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  runs: write.runs,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const off = vaultSwitchedOff(write, ctx.enabledModules);
    if (off) return { ok: false, error: `The ${off} workspace is switched off, so nothing can be changed there.` };
    const vault = await ctx.db('obsidian');
    const env: VaultWriteEnv = {
      userId: ctx.userId,
      vault,
      core: await ctx.db('core'),
      you: await ctx.db('you'),
      notes: vaultNotePorts(vault, ctx.userId),
    };
    const made = await runVaultWrite(write, env, input);
    if ('ok' in made) return made;
    return { ok: true, ...made, input: made.input as unknown as Record<string, unknown> };
  },
}));
