import 'server-only';

import { listAttachments, recordAttachments, type Attachment } from '@/lib/attachments/store';
import { ATTACHMENTS_BUCKET } from '@/lib/attachments/rules';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { readFile, withinRequest, type DashFile } from '@/lib/dash/files';
import { turnFilesRef, type NewTalkTurn, type TalkFile, type TalkTurn } from './talk';

/**
 * The files sent with a question (plan #1715), kept in core.attachments under
 * `core.conversation_turns:<turn id>` (lib/attachments/store.ts). The turn
 * does not hold them: this joins the two on the way out and records them on
 * the way in. Plan #1716 reads a turn's files for Dash with `readTurnFiles`.
 */

function toFile(attachment: Attachment): TalkFile {
  const { id, name, contentType, size, href } = attachment;
  return { id, name, contentType, size, href };
}

/** The turns with the files each was sent with; turns with none are returned as they were. */
export async function withTurnFiles(core: CoreSupabaseClient, turns: readonly TalkTurn[]): Promise<TalkTurn[]> {
  const users = turns.filter((turn) => turn.role === 'user');
  if (users.length === 0) return [...turns];
  const byRef = await listAttachments(core, users.map((turn) => turnFilesRef(turn.id)));
  return turns.map((turn) => {
    const held = byRef.get(turnFilesRef(turn.id));
    return held && held.length > 0 ? { ...turn, files: held.map(toFile) } : turn;
  });
}

/**
 * Records the files of each turn that came with some against the turn as
 * written (`written` is in the order of `sent`), and returns the written turns
 * carrying them.
 */
export async function recordTurnFiles(
  core: CoreSupabaseClient,
  userId: string,
  sent: readonly NewTalkTurn[],
  written: readonly TalkTurn[],
): Promise<TalkTurn[]> {
  const out: TalkTurn[] = [];
  for (const [index, turn] of written.entries()) {
    const files = sent[index]?.files;
    if (!files || files.length === 0) {
      out.push(turn);
      continue;
    }
    const recorded = await recordAttachments(core, userId, turnFilesRef(turn.id), files);
    out.push(recorded.length > 0 ? { ...turn, files: recorded.map(toFile) } : turn);
  }
  return out;
}

/** The full attachments (with storage paths) a turn was sent with, oldest first, for the model to read. */
export async function turnFiles(core: CoreSupabaseClient, turnId: string): Promise<Attachment[]> {
  return (await listAttachments(core, [turnFilesRef(turnId)])).get(turnFilesRef(turnId)) ?? [];
}

/**
 * The files a turn was sent with, downloaded through the person's own client
 * and read for Dash (plan #1716): pictures and PDFs as they are, Word, text
 * and CSV as text, and anything that cannot be read named with the reason.
 */
export async function readTurnFiles(core: CoreSupabaseClient, turnId: string): Promise<DashFile[]> {
  const held = await turnFiles(core, turnId);
  const read = await Promise.all(
    held.map(async (file): Promise<DashFile> => {
      const { data, error } = await core.storage.from(ATTACHMENTS_BUCKET).download(file.path);
      if (error || !data) return { name: file.name, kind: 'unread', why: 'it could not be fetched from storage' };
      return readFile(file.name, file.contentType, new Uint8Array(await data.arrayBuffer()));
    }),
  );
  return withinRequest(read);
}
