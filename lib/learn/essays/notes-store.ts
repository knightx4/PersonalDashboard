import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { locateAnchor, makeAnchor, type Anchor } from './anchor';
import { bodyAt, notesToOpen, stoppedChecks, type Finding, type NoteState } from './checks';

/**
 * Reads and writes on `learn.essay_notes` (plan #1869), through the person's
 * own session so RLS decides which rows are theirs. The table has no trigger
 * keeping `updated_at`, so every write here sets it.
 */

export type NoteStatus = NoteState['status'];

/** A margin note as the page holds it. Where it sits is worked out from the anchor against the text. */
export type EssayNote = {
  id: string;
  checkName: string;
  rung: number;
  body: string;
  ladder: string[];
  why: string;
  status: NoteStatus;
  anchor: Anchor;
  createdAt: string;
};

/** The notes the page shows (open, waiting and detached), and the checks that have stopped. */
export type EssayNotes = { notes: EssayNote[]; stopped: string[] };

const COLUMNS =
  'id, check_name, rung, body, ladder, why, status, anchor_quote, anchor_prefix, anchor_suffix, anchor_offset, created_at';

type Row = {
  id: string;
  check_name: string;
  rung: number;
  body: string;
  ladder: unknown;
  why: string;
  status: NoteStatus;
  anchor_quote: string;
  anchor_prefix: string;
  anchor_suffix: string;
  anchor_offset: number | null;
  created_at: string;
};

function toNote(row: Row): EssayNote {
  return {
    id: row.id,
    checkName: row.check_name,
    rung: row.rung,
    body: row.body,
    ladder: Array.isArray(row.ladder) ? row.ladder.filter((s): s is string => typeof s === 'string') : [],
    why: row.why,
    status: row.status,
    anchor: {
      quote: row.anchor_quote,
      prefix: row.anchor_prefix,
      suffix: row.anchor_suffix,
      offset: row.anchor_offset,
    },
    createdAt: row.created_at,
  };
}

/** The anchor's columns, for a write. */
function anchorColumns(anchor: Anchor) {
  return {
    anchor_quote: anchor.quote,
    anchor_prefix: anchor.prefix,
    anchor_suffix: anchor.suffix,
    anchor_offset: anchor.offset,
  };
}

/** Every note on the essay, closed ones too, oldest first. */
async function loadRows(supabase: LearnSupabaseClient, essayId: string): Promise<EssayNote[]> {
  const { data, error } = await supabase
    .from('essay_notes')
    .select(COLUMNS)
    .eq('essay_id', essayId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(`Could not read the essay's notes: ${error.message}`);
  return ((data ?? []) as Row[]).map(toNote);
}

function state(note: EssayNote): NoteState {
  return {
    id: note.id,
    checkName: note.checkName,
    status: note.status,
    quote: note.anchor.quote,
    createdAt: note.createdAt,
  };
}

function shown(notes: readonly EssayNote[]): EssayNotes {
  return {
    notes: notes.filter((note) => note.status === 'open' || note.status === 'waiting' || note.status === 'detached'),
    stopped: [...stoppedChecks(notes.map(state))],
  };
}

async function update(
  supabase: LearnSupabaseClient,
  noteId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('essay_notes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', noteId);
  if (error) throw new Error(error.message);
}

/** Open the waiting notes there is now room for, in place in `notes`. */
async function openWaiting(supabase: LearnSupabaseClient, notes: EssayNote[]): Promise<void> {
  for (const id of notesToOpen(notes.map(state))) {
    await update(supabase, id, { status: 'open' });
    const note = notes.find((n) => n.id === id);
    if (note) note.status = 'open';
  }
}

/**
 * The notes on an essay, found again in the draft as it now is (spec,
 * "Margin notes and checks"). A note found anywhere but at its stored offset
 * has its anchor rewritten where it was found, so the next load finds it at
 * once; a note whose text has gone is marked detached, and a waiting note
 * takes its place.
 */
export async function loadEssayNotes(
  supabase: LearnSupabaseClient,
  essayId: string,
  doc: string,
): Promise<EssayNotes> {
  const notes = await loadRows(supabase, essayId);
  let detached = false;
  for (const note of notes) {
    if (note.status !== 'open' && note.status !== 'waiting') continue;
    const at = locateAnchor(doc, note.anchor);
    if (!at) {
      await update(supabase, note.id, { status: 'detached' });
      note.status = 'detached';
      detached = true;
    } else if (at.how !== 'offset') {
      note.anchor = makeAnchor(doc, at.from, at.to);
      await update(supabase, note.id, anchorColumns(note.anchor));
    }
  }
  if (detached) await openWaiting(supabase, notes);
  return shown(notes);
}

/** The notes the rules need to decide what a new run may raise. */
export async function loadNoteStates(supabase: LearnSupabaseClient, essayId: string): Promise<NoteState[]> {
  return (await loadRows(supabase, essayId)).map(state);
}

/** What a check found, as new notes, open while there is room and waiting after. */
export async function insertNotes(
  supabase: LearnSupabaseClient,
  userId: string,
  essayId: string,
  checkName: string,
  found: readonly { finding: Finding; status: 'open' | 'waiting' }[],
): Promise<void> {
  if (found.length === 0) return;
  const now = Date.now();
  const { error } = await supabase.from('essay_notes').insert(
    found.map(({ finding, status }, i) => ({
      user_id: userId,
      essay_id: essayId,
      check_name: checkName,
      rung: finding.rung,
      body: bodyAt(finding.ladder, finding.rung),
      ladder: finding.ladder,
      why: finding.why,
      status,
      ...anchorColumns(finding.anchor),
      // One run's notes keep the order they were found in when they wait.
      created_at: new Date(now + i).toISOString(),
      updated_at: new Date(now).toISOString(),
    })),
  );
  if (error) throw new Error(`Could not keep the notes: ${error.message}`);
}

/** The notes the page shows, after a change to them. */
export async function shownNotes(supabase: LearnSupabaseClient, essayId: string): Promise<EssayNotes> {
  return shown(await loadRows(supabase, essayId));
}

/** One note, or null when it is not on this essay. */
export async function loadNote(
  supabase: LearnSupabaseClient,
  essayId: string,
  noteId: string,
): Promise<EssayNote | null> {
  const { data, error } = await supabase
    .from('essay_notes')
    .select(COLUMNS)
    .eq('essay_id', essayId)
    .eq('id', noteId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the note: ${error.message}`);
  return data ? toNote(data as Row) : null;
}

/** Move a note to a rung, saying what that rung says. */
export async function setNoteRung(supabase: LearnSupabaseClient, note: EssayNote, rung: number): Promise<void> {
  await update(supabase, note.id, { rung, body: rung === 4 ? note.body : bodyAt(note.ladder, rung) });
}

/**
 * Close a note as done or dismissed, and open the oldest waiting ones there
 * is now room for. Returns what the page shows after.
 */
export async function closeNote(
  supabase: LearnSupabaseClient,
  essayId: string,
  noteId: string,
  status: 'done' | 'dismissed',
): Promise<EssayNotes> {
  await update(supabase, noteId, { status });
  const notes = await loadRows(supabase, essayId);
  await openWaiting(supabase, notes);
  return shown(notes);
}

/** Where the notes sit now, as the editor has moved them with the person's edits. */
export async function moveNotes(
  supabase: LearnSupabaseClient,
  essayId: string,
  moves: readonly { id: string; anchor: Anchor }[],
): Promise<void> {
  for (const move of moves) {
    const { error } = await supabase
      .from('essay_notes')
      .update({ ...anchorColumns(move.anchor), updated_at: new Date().toISOString() })
      .eq('essay_id', essayId)
      .eq('id', move.id)
      .in('status', ['open', 'waiting']);
    if (error) throw new Error(error.message);
  }
}
