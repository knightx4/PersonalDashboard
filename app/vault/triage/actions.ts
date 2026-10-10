'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { noteCreatePorts, noteRemovePorts, noteSavePorts } from '@/lib/vault/db/ports';
import { embedVaultNotes } from '@/lib/vault/notes/embed';
import { FILE_ERRORS, fileQuickNote, type FileQuickNoteFailure } from '@/lib/vault/notes/file';
import { noteHref } from '@/lib/vault/paths';

/**
 * Filing a quick note out of Quick note triage (plan #1728, feature #1726):
 * into another note, or as a note of its own. The order and the refusals are
 * in lib/vault/notes/file.ts; this binds them to the signed-in person's
 * session, so RLS decides whether the notes and the connection are theirs.
 */

export type FileQuickNoteState = {
  /** Where the text went, once it has been filed. */
  filedPath?: string;
  filedTitle?: string;
  /** Said when the text was filed but the Inbox file is still there. */
  warning?: string;
  reason?: FileQuickNoteFailure;
  error?: string;
};

const path = z.string().trim().min(1).max(1024);

const FileInput = z.object({
  quickPath: path,
  quickBlobSha: z.string().trim().min(1).optional(),
  /** A note's path, or empty to make the quick note a note of its own. */
  targetPath: path.optional(),
  targetBlobSha: z.string().trim().min(1).optional(),
});

/** How long the embedding after a filing may run, as after a save. */
const EMBED_AFTER_FILE_MS = 20_000;

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Takes `quickPath` and `quickBlobSha` (the quick note as shown), and either
 * `targetPath` with `targetBlobSha` (the note to add it to) or neither, to
 * make it a note of its own.
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
        remove: noteRemovePorts(vault),
      },
      {
        quickPath: input.data.quickPath,
        quickBlobSha: input.data.quickBlobSha,
        target: input.data.targetPath
          ? { kind: 'note', path: input.data.targetPath, blobSha: input.data.targetBlobSha }
          : { kind: 'own' },
      },
    );
  } catch (error) {
    console.error('[vault file]', error instanceof Error ? error.message : error);
    return { reason: 'error', error: FILE_ERRORS.error };
  }

  if (!result.ok) return { reason: result.reason, error: result.error };

  revalidatePath('/vault');
  revalidatePath(noteHref(result.path));
  revalidatePath(noteHref(input.data.quickPath));
  return { filedPath: result.path, filedTitle: result.title, warning: result.warning };
}
