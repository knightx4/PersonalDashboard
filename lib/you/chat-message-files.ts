import 'server-only';

import { listAttachments, recordAttachments, type Attachment } from '@/lib/attachments/store';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { DashFile } from '@/lib/dash/files';
import { readHeldFiles } from '@/lib/talk/turn-files';
import { messageFilesRef, type ThreadFile, type ThreadMessage } from '@/lib/you/chat-threads-model';

/**
 * The pictures and PDFs sent with a message on People (plan #2974), kept in
 * core.attachments under `you.advisor_messages:<message id>`, the one store
 * Ask's questions use (lib/talk/turn-files.ts). The message row does not hold
 * them: this records them on the way in, joins them on the way out, and reads
 * them for the reply.
 */

function toFile({ id, name, contentType, size, href }: Attachment): ThreadFile {
  return { id, name, contentType, size, href };
}

/** Records the files sent with a message against it, and returns them as the thread draws them. */
export async function recordMessageFiles(
  core: CoreSupabaseClient,
  userId: string,
  messageId: string,
  files: readonly UploadedAttachment[],
): Promise<ThreadFile[]> {
  if (files.length === 0) return [];
  return (await recordAttachments(core, userId, messageFilesRef(messageId), files)).map(toFile);
}

/** The messages with the files each of the person's was sent with; the rest are returned as they were. */
export async function withMessageFiles(core: CoreSupabaseClient, messages: readonly ThreadMessage[]): Promise<ThreadMessage[]> {
  const theirs = messages.filter((m) => m.role === 'person');
  if (theirs.length === 0) return [...messages];
  const byRef = await listAttachments(core, theirs.map((m) => messageFilesRef(m.id)));
  return messages.map((m) => {
    const held = byRef.get(messageFilesRef(m.id));
    return held && held.length > 0 ? { ...m, files: held.map(toFile) } : m;
  });
}

/**
 * The files sent with these messages, oldest first, downloaded and read for
 * the model: pictures and PDFs as they are, as Ask reads a question's.
 */
export async function readMessageFiles(core: CoreSupabaseClient, messageIds: readonly string[]): Promise<DashFile[]> {
  if (messageIds.length === 0) return [];
  const byRef = await listAttachments(core, messageIds.map(messageFilesRef));
  const held = messageIds.flatMap((id) => byRef.get(messageFilesRef(id)) ?? []);
  return held.length > 0 ? readHeldFiles(core, held) : [];
}
