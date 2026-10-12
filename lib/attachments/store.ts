import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { parseRef } from '@/lib/core/refs';
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENTS_PER_ITEM,
  attachmentHref,
  type UploadedAttachment,
} from './rules';

/**
 * Recording, reading and removing the files a row holds (plan #1712).
 *
 * Every call takes the core client on the person's own session
 * (createCoreClient), so RLS keeps each account to its own rows and the
 * bucket's policies to its own folder. A row is named by its ref,
 * `schema.table:id`, as everywhere else (lib/core/refs.ts).
 */

/** One file as a row's page shows it. */
export type Attachment = {
  id: string;
  ref: string;
  path: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
  /** Opens the file at full size through a short signed link. */
  href: string;
};

type Row = {
  id: string;
  ref: string;
  path: string;
  name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

const COLUMNS = 'id, ref, path, name, content_type, size_bytes, created_at';

function toAttachment(row: Row): Attachment {
  return {
    id: row.id,
    ref: row.ref,
    path: row.path,
    name: row.name,
    contentType: row.content_type,
    size: Number(row.size_bytes),
    createdAt: row.created_at,
    href: attachmentHref(row.id),
  };
}

/**
 * Record uploaded files against a row. Call it from the server action that
 * saved the row, once it has the row's id, with the list
 * parseUploadedAttachments returned. Recording the same files against a
 * second row (a capture Dash split in two) shares the copies in storage.
 * A file already recorded against this row is left as it is, and only the
 * newly recorded ones are returned.
 */
export async function recordAttachments(
  client: CoreSupabaseClient,
  userId: string,
  ref: string,
  files: readonly UploadedAttachment[],
): Promise<Attachment[]> {
  if (files.length === 0) return [];
  if (!parseRef(ref)) throw new Error(`Not a row ref: ${ref}`);
  if (files.length > ATTACHMENTS_PER_ITEM) {
    throw new Error(`A row holds ${ATTACHMENTS_PER_ITEM} files at most.`);
  }

  // Left out before inserting rather than by ON CONFLICT, since the table's
  // five-to-a-row trigger counts a duplicate before the conflict is found.
  const { data: held, error: heldError } = await client
    .from('attachments')
    .select('path')
    .eq('ref', ref)
    .in('path', files.map((file) => file.path));
  if (heldError) throw new Error(`Reading the files failed: ${heldError.message}`);
  const already = new Set(((held ?? []) as { path: string }[]).map((row) => row.path));
  const fresh = files.filter((file) => !already.has(file.path));
  if (fresh.length === 0) return [];

  const { data, error } = await client
    .from('attachments')
    .insert(
      fresh.map((file) => ({
        user_id: userId,
        ref,
        path: file.path,
        name: file.name,
        content_type: file.contentType,
        size_bytes: file.size,
      })),
    )
    .select(COLUMNS);
  if (error) throw new Error(`Recording the files failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toAttachment);
}

/**
 * The files each of these rows holds, oldest first, keyed by ref. A ref with
 * no files is absent from the map, so a list can ask for every row it shows
 * in one query and draw a paperclip only where there is one.
 */
export async function listAttachments(
  client: CoreSupabaseClient,
  refs: readonly string[],
): Promise<Map<string, Attachment[]>> {
  const byRef = new Map<string, Attachment[]>();
  const wanted = [...new Set(refs)];
  if (wanted.length === 0) return byRef;

  const { data, error } = await client
    .from('attachments')
    .select(COLUMNS)
    .in('ref', wanted)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading the files failed: ${error.message}`);

  for (const row of (data ?? []) as Row[]) {
    const list = byRef.get(row.ref) ?? [];
    list.push(toAttachment(row));
    byRef.set(row.ref, list);
  }
  return byRef;
}

/**
 * Remove the files from storage that no row records any more. Takes the
 * paths a caller just stopped recording; a path another row still records
 * is kept. Returns the paths it removed.
 */
export async function removeUnrecorded(
  client: CoreSupabaseClient,
  paths: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return [];

  const { data, error } = await client.from('attachments').select('path').in('path', unique);
  if (error) throw new Error(`Checking the files failed: ${error.message}`);
  const stillHeld = new Set(((data ?? []) as { path: string }[]).map((row) => row.path));
  const orphans = unique.filter((path) => !stillHeld.has(path));
  if (orphans.length === 0) return [];

  const { error: removeError } = await client.storage.from(ATTACHMENTS_BUCKET).remove(orphans);
  if (removeError) throw new Error(`Removing the files failed: ${removeError.message}`);
  return orphans;
}

/**
 * Forget every file a row holds, and remove each copy no other row records.
 * Call it when the row itself goes (an Undo, a delete), since a ref is not a
 * foreign key and nothing cascades from the row to its files. Returns the
 * paths removed from storage.
 */
export async function removeAttachmentsFor(
  client: CoreSupabaseClient,
  ref: string,
): Promise<string[]> {
  const { data, error } = await client.from('attachments').delete().eq('ref', ref).select('path');
  if (error) throw new Error(`Forgetting the files failed: ${error.message}`);
  const paths = ((data ?? []) as { path: string }[]).map((row) => row.path);
  return removeUnrecorded(client, paths);
}
