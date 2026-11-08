'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { embedVaultNotes } from '@/lib/vault/notes/embed';
import { noteCreatePorts, noteSavePorts } from '@/lib/vault/db/ports';
import { FILE_ERRORS, fileQuickNote, type FileQuickNoteFailure } from '@/lib/vault/notes/file';
import { loadNotes } from '@/lib/vault/notes/load';
import { folderOf, INBOX_FOLDER, isTriageNotePath, noteHref, TRIAGE_NOTE_PATH } from '@/lib/vault/paths';

/**
 * Filing a quick note out of Quick note triage (plan #1728, feature #1726):
 * into another note, or as a note of its own. A quick note is a section of
 * that one note (plan #3063), and filing takes its section out. The order and the refusals are
 * in lib/vault/notes/file.ts; this binds them to the signed-in person's
 * session, so RLS decides whether the notes and the connection are theirs.
 */

export type FileQuickNoteState = {
  /** Where the text went, once it has been filed. */
  filedPath?: string;
  filedTitle?: string;
  /** Said when the text was filed but its section is still in Quick note triage. */
  warning?: string;
  reason?: FileQuickNoteFailure;
  error?: string;
};

const path = z.string().trim().min(1).max(1024);

/** A quick note's path: Quick note triage, then its section's id (plan #3063). */
function sectionIdOf(quickPath: string): string | null {
  const prefix = `${TRIAGE_NOTE_PATH}#`;
  if (!quickPath.startsWith(prefix)) return null;
  const id = quickPath.slice(prefix.length);
  return /^qn-[a-z0-9-]+$/.test(id) ? id : null;
}

const FileInput = z.object({
  /** `Quick note triage.md#<section id>`, as loadTriageNotes gives it. */
  quickPath: z.string().trim().refine((value) => sectionIdOf(value) !== null),
  /** The fingerprint of the text it was shown with (quickSectionFingerprint). */
  quickBlobSha: z.string().trim().min(1).optional(),
  /** A note's path, or empty to make the quick note a note of its own. */
  targetPath: path.optional(),
  targetBlobSha: z.string().trim().min(1).optional(),
  /** The name for a note of its own, when the person changed it (note 24fd1e02). */
  title: z.string().trim().max(200).optional(),
});

/** How long the embedding after a filing may run, as after a save. */
const EMBED_AFTER_FILE_MS = 20_000;

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Takes `quickPath` and `quickBlobSha` (the quick note as shown: its section
 * and the fingerprint of its text), and either
 * `targetPath` with `targetBlobSha` (the note to add it to) or neither, to
 * make it a note of its own, named `title` when one is given.
 */
// latency: pending
export async function fileQuickNoteAction(
  _prev: FileQuickNoteState,
  formData: FormData,
): Promise<FileQuickNoteState> {
  const user = await requireUser();

  const input = FileInput.safeParse({
    quickPath: field(formData, 'quickPath') ?? '',
    quickBlobSha: field(formData, 'quickBlobSha'),
    targetPath: field(formData, 'targetPath'),
    targetBlobSha: field(formData, 'targetBlobSha'),
    title: field(formData, 'title'),
  });
  if (!input.success) return { reason: 'error', error: 'Dash could not tell which quick note that was.' };

  const vault = await createVaultClient();
  const afterSave = () => {
    after(async () => {
      try {
        await embedVaultNotes(vault, await createCoreClient(), {
          userId: user.id,
          deadline: Date.now() + EMBED_AFTER_FILE_MS,
        });
      } catch (error) {
        console.error('[vault file] note embedding', error instanceof Error ? error.message : error);
      }
    });
  };

  let result;
  try {
    result = await fileQuickNote(
      {
        save: noteSavePorts({ supabase: vault, afterSave }),
        create: noteCreatePorts({ supabase: vault, afterSave }),
      },
      {
        sectionId: sectionIdOf(input.data.quickPath)!,
        fingerprint: input.data.quickBlobSha,
        target: input.data.targetPath
          ? { kind: 'note', path: input.data.targetPath, blobSha: input.data.targetBlobSha }
          : { kind: 'own', title: input.data.title },
      },
    );
  } catch (error) {
    console.error('[vault file]', error instanceof Error ? error.message : error);
    return { reason: 'error', error: FILE_ERRORS.error };
  }

  if (!result.ok) return { reason: result.reason, error: result.error };

  revalidatePath('/vault');
  revalidatePath(noteHref(result.path));
  revalidatePath(noteHref(TRIAGE_NOTE_PATH));
  return { filedPath: result.path, filedTitle: result.title, warning: result.warning };
}

/** A note a quick note can be added to, as triage draws it. */
export type TriagePlace = { path: string; title: string; href: string };

/** Places a search offers at once. */
const SEARCH_PLACES_SHOWN = 5;

/**
 * Notes outside the Inbox whose title or text match `query`, for adding a
 * quick note to one the suggestions missed (plan #1729). The vault list's own
 * full-text search; RLS keeps it to the person's notes.
 */
// latency: pending
export async function searchTriagePlaces(query: string): Promise<TriagePlace[]> {
  await requireUser();
  const search = query.trim().slice(0, 200);
  if (!search) return [];
  const vault = await createVaultClient();
  const found = await loadNotes(vault, { search, limit: SEARCH_PLACES_SHOWN * 4 });
  return found
    .filter((note) => folderOf(note.path) !== INBOX_FOLDER && !isTriageNotePath(note.path))
    .slice(0, SEARCH_PLACES_SHOWN)
    .map((note) => ({ path: note.path, title: note.title, href: noteHref(note.path) }));
}
