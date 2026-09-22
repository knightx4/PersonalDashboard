'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { createVaultClient } from '@/lib/vault/auth/server';
import { acceptNoteMap } from '@/lib/vault/map/accept';
import { proposeNoteMap } from '@/lib/vault/map/extract';
import { keepTickedMap } from '@/lib/vault/map/keep';
import { noteMapSchema, type NoteMapProposal } from '@/lib/vault/map/proposal';
import { quoteInNote } from '@/lib/vault/map/rules';
import { loadThemeNames } from '@/lib/vault/map/themes';
import { loadNote } from '@/lib/vault/notes/load';

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

  const existingThemes = await loadThemeNames(supabase);

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
  await requireUser();

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
