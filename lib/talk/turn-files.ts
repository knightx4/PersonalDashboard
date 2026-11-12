import 'server-only';

import { randomUUID } from 'node:crypto';
import { listAttachments, recordAttachments, type Attachment } from '@/lib/attachments/store';
import { ATTACHMENTS_BUCKET, attachmentPath, type UploadedAttachment } from '@/lib/attachments/rules';
import type { MadeFile, UnkeptFile } from './made-files';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { readFile, withinRequest, type DashFile } from '@/lib/dash/files';
import { turnFilesRef, type NewTalkTurn, type TalkFile, type TalkTurn } from './talk';

/**
 * The files sent with a question (plan #1715), kept in core.attachments under
 * `core.conversation_turns:<turn id>` (lib/attachments/store.ts). The turn
 * does not hold them: this joins the two on the way out and records them on
 * the way in. Plan #1716 reads a turn's files for Dash with `readTurnFiles`.
 *
 * Dash's answer holds files too when its code made some (plan #3050.3.2),
 * under the same ref: keepTurnMadeFiles stores them, and withTurnFiles joins
 * them to the answer as it does to a question.
 */

function toFile(attachment: Attachment): TalkFile {
  const { id, name, contentType, size, href } = attachment;
  return { id, name, contentType, size, href };
}

/**
 * The turns with the files each holds: a question's that were sent with it,
 * an answer's that its code made. Turns with none are returned as they were.
 */
export async function withTurnFiles(core: CoreSupabaseClient, turns: readonly TalkTurn[]): Promise<TalkTurn[]> {
  if (turns.length === 0) return [];
  const byRef = await listAttachments(core, turns.map((turn) => turnFilesRef(turn.id)));
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
 * and read for Dash (plan #1716): pictures and PDFs as they are, a picture
 * too large to send as a smaller copy (plan #2032.1), Word, text
 * and CSV as text, and anything that cannot be read named with the reason.
 */
export async function readTurnFiles(core: CoreSupabaseClient, turnId: string): Promise<DashFile[]> {
  return readHeldFiles(core, await turnFiles(core, turnId));
}

/**
 * Recorded files downloaded and read for the model, within one request's
 * size: Ask's question files and a People message's (plan #2974) alike.
 */
export async function readHeldFiles(core: CoreSupabaseClient, held: readonly Attachment[]): Promise<DashFile[]> {
  const read = await Promise.all(
    held.map(async (file): Promise<DashFile> => {
      const { data, error } = await core.storage.from(ATTACHMENTS_BUCKET).download(file.path);
      if (error || !data) return { name: file.name, kind: 'unread', why: 'it could not be fetched from storage' };
      return readFile(file.name, file.contentType, new Uint8Array(await data.arrayBuffer()));
    }),
  );
  return withinRequest(read);
}

/**
 * Puts the files a bot's code made in the person's folder of the attachments
 * bucket (plans #3050.3.1, #3050.3.2), ready to record against the message
 * or turn they go with. A file the bucket refuses is returned as unkept with
 * the reason, and the rest are still stored.
 */
export async function storeMadeFiles(
  core: CoreSupabaseClient,
  userId: string,
  files: readonly MadeFile[],
): Promise<{ uploaded: UploadedAttachment[]; unkept: UnkeptFile[] }> {
  const uploaded: UploadedAttachment[] = [];
  const unkept: UnkeptFile[] = [];
  for (const file of files) {
    const path = attachmentPath(userId, randomUUID(), file.name);
    const { error } = await core.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file.bytes, { contentType: file.contentType, upsert: false });
    if (error) {
      console.error('a file a bot made was not stored', file.name, error);
      unkept.push({ name: file.name, why: 'storage would not take it' });
      continue;
    }
    uploaded.push({ path, name: file.name, contentType: file.contentType, size: file.bytes.byteLength });
  }
  return { uploaded, unkept };
}

/**
 * Stores the files a bot's code made and records them against `ref` in one
 * insert. When the insert fails, the stored copies are removed and every
 * file is returned as unkept, so the reply can say so.
 */
export async function keepMadeFilesAt(
  core: CoreSupabaseClient,
  userId: string,
  ref: string,
  files: readonly MadeFile[],
): Promise<{ kept: Attachment[]; unkept: UnkeptFile[] }> {
  const { uploaded, unkept } = await storeMadeFiles(core, userId, files);
  if (uploaded.length === 0) return { kept: [], unkept };
  try {
    return { kept: await recordAttachments(core, userId, ref, uploaded), unkept };
  } catch (error) {
    console.error('the files a bot made were not recorded', error);
    await core.storage.from(ATTACHMENTS_BUCKET).remove(uploaded.map((file) => file.path)).catch(() => undefined);
    return { kept: [], unkept: [...unkept, ...uploaded.map((file) => ({ name: file.name, why: 'it could not be recorded with the reply' }))] };
  }
}

/** Keeps the files Dash's code made for an answer against its turn (plan #3050.3.2), as the chat draws them. */
export async function keepTurnMadeFiles(
  core: CoreSupabaseClient,
  userId: string,
  turnId: string,
  files: readonly MadeFile[],
): Promise<{ kept: TalkFile[]; unkept: UnkeptFile[] }> {
  const { kept, unkept } = await keepMadeFilesAt(core, userId, turnFilesRef(turnId), files);
  return { kept: kept.map(toFile), unkept };
}
