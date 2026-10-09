import { createClient } from '@/lib/auth/client';
import {
  ATTACHMENTS_BUCKET,
  attachmentContentType,
  attachmentPath,
  attachmentProblem,
  type UploadedAttachment,
} from '@/lib/attachments/rules';

/**
 * Put one file in your folder of the attachments bucket, from the browser
 * (plan #1712). The file goes straight to storage on your session, so it
 * never passes through a server action's one-megabyte body; the action that
 * saves the row it came with records it afterwards (recordAttachments).
 */
export async function uploadAttachment(
  file: File,
): Promise<{ file: UploadedAttachment } | { error: string }> {
  const problem = attachmentProblem(file);
  const contentType = attachmentContentType(file.name);
  if (problem || !contentType) return { error: problem ?? `${file.name} cannot be added.` };

  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'You are signed out. Sign in again to add a file.' };

  const path = attachmentPath(data.user.id, crypto.randomUUID(), file.name);
  const { error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) return { error: `${file.name} could not be uploaded. Try again.` };

  return { file: { path, name: file.name, contentType, size: file.size } };
}

/**
 * Take back a file uploaded and then removed before the row was saved, so
 * the folder does not keep it. Best effort: a copy left behind costs only
 * space, and the account's deletion clears the folder.
 */
export async function discardUpload(path: string): Promise<void> {
  try {
    await createClient().storage.from(ATTACHMENTS_BUCKET).remove([path]);
  } catch {
    // As above.
  }
}
