'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { acceptNoteMap } from '@/lib/vault/map/accept';
import { embedMapRowsAfterResponse } from '@/lib/vault/map/embed';
import { proposeNoteMap } from '@/lib/vault/map/extract';
import { keepTickedMap } from '@/lib/vault/map/keep';
import { noteMapSchema, type NoteMapProposal } from '@/lib/vault/map/proposal';
import { quoteInNote } from '@/lib/vault/map/rules';
import { loadNearestThemeNames, loadThemeNames, offerThemes } from '@/lib/vault/map/themes';
import { loadNote } from '@/lib/vault/notes/load';
import { loadNoteThread, saveThought } from '@/lib/vault/maya/store';
import { MAYA_THOUGHT_OPERATION, writeThought } from '@/lib/vault/maya/thought';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { noteSavePorts } from '@/lib/vault/db/ports';
import { embedVaultNotes } from '@/lib/vault/notes/embed';
import { saveNote, type SaveNoteFailure } from '@/lib/vault/notes/save';
import { mayaThreadHref, noteHref } from '@/lib/vault/paths';

/**
 * Reading one note for the map, and writing what the person keeps.
 *
 * Two actions and a person between them, as with the Learn imports.
 * `proposeMap` calls the model and writes nothing: the proposal lives in the
 * page's state and nowhere else. `acceptMap` writes the ticked part of it.
 *
 * Neither trusts the note it is handed. Both take the path and read the note
 * again on the session client, so RLS decides whether it is yours, and the
 * accept compares the version it was proposed from with the version there now
 * before handing the map to obsidian.accept_note_map, which checks both again
 * inside its own transaction.
 */

export type ProposeMapState = {
  proposal?: NoteMapProposal;
  /** Said plainly: the note was not read, or was read and holds nothing. */
  message?: string;
  error?: string;
};

export type AcceptMapState = {
  /** What landed, as a sentence. */
  added?: string;
  error?: string;
};

const notePath = z.string().trim().min(1, 'Which note?').max(1024);

// latency: pending
export async function proposeMap(
  _prev: ProposeMapState,
  formData: FormData,
): Promise<ProposeMapState> {
  const user = await requireUser();

  const path = notePath.safeParse(formData.get('notePath') ?? '');
  if (!path.success) return { error: path.error.issues[0]?.message ?? 'Which note?' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Reading a note needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createVaultClient();
  const note = await loadNote(supabase, path.data);
  if (!note) return { error: 'That note is not in the vault any more.' };

  const embedSpend = collectSpend();
  const [nearest, strongest] = await Promise.all([
    loadNearestThemeNames(supabase, note, { onSpend: embedSpend.sink }),
    loadThemeNames(supabase),
  ]);
  await recordLearnSpend(user.id, 'embed-map', embedSpend.reports);
  const existingThemes = offerThemes(nearest, strongest);

  const spend = collectSpend();
  const result = await proposeNoteMap({
    note: { id: note.id, path: note.path, title: note.title, body: note.body, blobSha: note.blobSha },
    existingThemes,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'map-note', spend.reports);

  if (result.ok) return { proposal: result.proposal };
  // A refusal and an empty reading are answers, not failures: the note was
  // looked at and there is nothing to review.
  return result.reason === 'error' ? { error: result.detail } : { message: result.detail };
}

const AcceptInput = z.object({
  notePath,
  blobSha: z.string().min(1),
  map: z.string().min(2),
  keep: z.array(z.string()),
});

// latency: pending
export async function acceptMap(
  _prev: AcceptMapState,
  formData: FormData,
): Promise<AcceptMapState> {
  const user = await requireUser();

  const input = AcceptInput.safeParse({
    notePath: formData.get('notePath') ?? '',
    blobSha: formData.get('blobSha') ?? '',
    map: formData.get('map') ?? '',
    keep: formData.getAll('keep').filter((value): value is string => typeof value === 'string'),
  });
  if (!input.success) return { error: 'The proposal did not come back whole. Read the note again.' };

  let raw: unknown;
  try {
    raw = JSON.parse(input.data.map);
  } catch {
    return { error: 'The proposal did not come back whole. Read the note again.' };
  }
  const proposed = noteMapSchema.safeParse(raw);
  if (!proposed.success) {
    return { error: proposed.error.issues[0]?.message ?? 'The proposal is malformed.' };
  }

  const { map } = keepTickedMap(proposed.data, new Set(input.data.keep));
  if (map.themes.length === 0 && map.positions.length === 0) {
    return { error: 'Nothing is ticked, so nothing was written.' };
  }

  const supabase = await createVaultClient();
  const note = await loadNote(supabase, input.data.notePath);
  if (!note) return { error: 'That note is not in the vault any more.' };

  // Checked here as well as in the database so the refusal names the problem
  // before a round trip, and so a quote the screen was shown is held to the
  // note as it is now, not as it was when the model read it.
  if (note.blobSha !== input.data.blobSha) {
    return { error: 'The note has changed since it was read. Read it again.' };
  }
  const missing = map.positions.find((position) => !quoteInNote(position.quote, note.body));
  if (missing) return { error: `The quote for "${missing.name}" is not in the note.` };

  const result = await acceptNoteMap(supabase, {
    noteId: note.id,
    blobSha: input.data.blobSha,
    map,
  });
  if (!result.ok) return { error: result.detail };

  // The new themes and positions get their vectors once this has answered.
  embedMapRowsAfterResponse(supabase, await createCoreClient(), user.id);

  return { added: addedSentence(result) };
}

function addedSentence(counts: {
  themes: number;
  positions: number;
  newPositions: number;
  edges: number;
}): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [n(counts.themes, 'theme', 'themes'), n(counts.positions, 'position', 'positions')];
  if (counts.edges > 0) parts.push(n(counts.edges, 'link', 'links'));
  const joined = counts.positions - counts.newPositions;
  const tail =
    joined > 0
      ? ` ${n(joined, 'position was', 'positions were')} already on the map, so this note was added as a source.`
      : '';
  return `Added ${parts.join(', ')} to the map.${tail}`;
}

export type AskMayaState = {
  /** The thread the thought went into, once there is one. */
  threadHref?: string;
  /** Said plainly: Maya looked and had nothing worth saying. */
  message?: string;
  error?: string;
};

/**
 * Ask Maya for its thoughts on this note (plan #1285).
 *
 * The note is read again on the session client, as the map's actions do, so
 * RLS decides whether it is yours. A note that already has a thread is not
 * sent again: the press answers with the thread. A thought with no points is
 * not stored, so the note can be asked about again once the vault around it
 * has grown.
 */
// latency: pending
export async function askMaya(_prev: AskMayaState, formData: FormData): Promise<AskMayaState> {
  const user = await requireUser();

  const path = notePath.safeParse(formData.get('notePath') ?? '');
  if (!path.success) return { error: path.error.issues[0]?.message ?? 'Which note?' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Asking Maya needs ANTHROPIC_API_KEY to be set.' };

  const vault = await createVaultClient();
  const note = await loadNote(vault, path.data);
  if (!note) return { error: 'That note is not in the vault any more.' };

  const existing = await loadNoteThread(vault, note.id);
  if (existing) return { threadHref: mayaThreadHref(existing.id) };

  const spend = collectSpend();
  const written = await writeThought({
    vault,
    userId: user.id,
    noteId: note.id,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, MAYA_THOUGHT_OPERATION, spend.reports);

  if (!written.ok) {
    return written.reason === 'error' || written.reason === 'no-key'
      ? { error: written.detail }
      : { message: written.detail };
  }
  if (written.points.length === 0) {
    return { message: 'Maya read this note and had nothing worth saying about it yet.' };
  }

  const saved = await saveThought(vault, {
    userId: user.id,
    noteId: note.id,
    origin: 'asked',
    written,
  });
  if (!saved.ok) return { error: saved.detail };

  revalidatePath(noteHref(note.path));
  return { threadHref: mayaThreadHref(saved.threadId) };
}

export type SaveNoteState = {
  /** The blob SHA the note is now at, once a save has gone through. */
  savedBlobSha?: string;
  /** What went wrong, for the page to choose its way forward (reload, settings). */
  reason?: SaveNoteFailure;
  error?: string;
};

/** What the person reads when a save does not go through. */
const SAVE_ERRORS: Record<SaveNoteFailure, string> = {
  'not-found': 'That note is not in the vault any more.',
  changed: 'This note changed since you opened it. Reload it to see the new version.',
  'read-only':
    'The vault token can read notes but not save them. Add a token that can write in vault settings.',
  reconnect: 'The vault needs reconnecting before notes can be saved.',
  'too-large': 'The note is too large to save from here.',
  error: 'The note could not be saved. Try again in a moment.',
};

const SaveInput = z.object({
  notePath,
  text: z.string().max(1_000_000, 'The note is too large to save from here.'),
  blobSha: z.string().trim().min(1),
});

/** How long the embedding after a save may run. One note is one call. */
const EMBED_AFTER_SAVE_MS = 20_000;

/**
 * Save an edited note (plan #1424): commit it to the vault repository as
 * "Edit <note> from Dash" and rewrite the stored note with the blob SHA the
 * commit made, so the next sync leaves it alone.
 *
 * Takes `notePath`, `text` (the new body, as the editor holds it, without the
 * frontmatter) and `blobSha` (the one the editor opened at). The note and the
 * connection are read again on the session client, so RLS decides whether
 * they are yours. Once saved, the note's embedding is redone after the
 * response, as a sync does for the notes it writes.
 */
// latency: pending
export async function saveNoteEdit(
  _prev: SaveNoteState,
  formData: FormData,
): Promise<SaveNoteState> {
  const user = await requireUser();

  const input = SaveInput.safeParse({
    notePath: formData.get('notePath') ?? '',
    text: formData.get('text') ?? '',
    blobSha: formData.get('blobSha') ?? '',
  });
  if (!input.success)
    return { reason: 'error', error: input.error.issues[0]?.message ?? SAVE_ERRORS.error };

  const vault = await createVaultClient();
  const ports = noteSavePorts({
    supabase: vault,
    afterSave: () => {
      after(async () => {
        try {
          await embedVaultNotes(vault, await createCoreClient(), {
            userId: user.id,
            deadline: Date.now() + EMBED_AFTER_SAVE_MS,
          });
        } catch (error) {
          console.error(
            '[vault save] note embedding',
            error instanceof Error ? error.message : error,
          );
        }
      });
    },
  });

  let result;
  try {
    result = await saveNote(ports, {
      path: input.data.notePath,
      text: input.data.text,
      expectedBlobSha: input.data.blobSha,
    });
  } catch (error) {
    console.error('[vault save]', error instanceof Error ? error.message : error);
    return { reason: 'error', error: SAVE_ERRORS.error };
  }

  if (!result.ok) {
    if (result.reason === 'error') console.error('[vault save]', result.detail);
    return { reason: result.reason, error: SAVE_ERRORS[result.reason] };
  }

  revalidatePath(noteHref(input.data.notePath));
  revalidatePath('/vault');
  return { savedBlobSha: result.blobSha };
}
