import 'server-only';

import { randomUUID } from 'node:crypto';
import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { TODO_SCHEMA, type TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import {
  ATTACHMENT_BUCKET,
  checkUpload,
  guessRole,
  isRole,
  MAX_PER_TARGET,
  storagePathFor,
  type AttachmentRole,
  type AttachmentTarget,
  type AttachmentView,
} from '@/lib/todo/attachments/model';

/**
 * Reading and writing attachments. Everything runs as the signed-in person,
 * so the table policies and the bucket's folder policy are what keep a file
 * theirs (0016); nothing here checks ownership by hand.
 */

const COLUMNS =
  'id, kind, role, name, note, mime_type, size_bytes, from_email_id, email_from, email_sent_at, email_text, email_gmail_url, created_at';

type Row = Record<string, unknown>;

function toView(row: Row): AttachmentView {
  return {
    id: row.id as string,
    kind: row.kind as 'file' | 'email',
    role: isRole(row.role) ? row.role : 'other',
    name: row.name as string,
    note: (row.note as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: (row.size_bytes as number | null) ?? null,
    fromEmailId: (row.from_email_id as string | null) ?? null,
    emailFrom: (row.email_from as string | null) ?? null,
    emailSentAt: (row.email_sent_at as string | null) ?? null,
    emailText: (row.email_text as string | null) ?? null,
    emailGmailUrl: (row.email_gmail_url as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

const targetColumn = (target: AttachmentTarget) =>
  target.kind === 'task' ? 'task_id' : 'event_id';

/** Everything on one task or event. */
export async function loadAttachments(
  target: AttachmentTarget,
  client?: TodoSupabaseClient,
): Promise<AttachmentView[]> {
  const supabase = client ?? (await createTodoClient());
  const { data, error } = await supabase
    .from('attachment_links')
    .select(`attachment:attachments!inner(${COLUMNS})`)
    .eq(targetColumn(target), target.id)
    .limit(MAX_PER_TARGET);
  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => (row as unknown as { attachment: Row | Row[] | null }).attachment)
    .map((a) => (Array.isArray(a) ? a[0] : a))
    .filter((a): a is Row => !!a)
    .map(toView);
}

/** How many attachments each of these tasks or events holds, for a badge on a row. */
export async function countAttachments(
  kind: AttachmentTarget['kind'],
  ids: readonly string[],
  client?: TodoSupabaseClient,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const supabase = client ?? (await createTodoClient());
  const column = kind === 'task' ? 'task_id' : 'event_id';
  const { data, error } = await supabase
    .from('attachment_links')
    .select(column)
    .in(column, [...ids]);
  if (error) return counts;
  for (const row of (data ?? []) as unknown as Row[]) {
    const id = row[column] as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export type UploadSlot =
  | { ok: true; id: string; path: string; token: string; name: string; mimeType: string }
  | { ok: false; error: string };

/**
 * Hands the browser a one-use URL to upload to. The file goes straight to the
 * bucket, so a 20 MB ticket PDF never has to fit through a server action.
 */
export async function createUploadSlot(
  userId: string,
  target: AttachmentTarget,
  file: { name: string; type: string; size: number },
): Promise<UploadSlot> {
  const checked = checkUpload(file);
  if (!checked.ok) return checked;

  const supabase = await createTodoClient();
  const held = await countOn(supabase, target);
  if (held >= MAX_PER_TARGET)
    return { ok: false, error: 'That one already holds as many attachments as it can.' };

  const id = randomUUID();
  const path = storagePathFor(userId, id);
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: 'The upload could not be started. Try again.' };
  return { ok: true, id, path, token: data.token, name: checked.name, mimeType: checked.mimeType };
}

async function countOn(supabase: TodoSupabaseClient, target: AttachmentTarget): Promise<number> {
  const { count } = await supabase
    .from('attachment_links')
    .select('id', { count: 'exact', head: true })
    .eq(targetColumn(target), target.id);
  return count ?? 0;
}

/**
 * Records a file the browser has uploaded, and puts it on the target. The
 * object is looked for first: a row pointing at nothing would open to an error.
 */
export async function registerUpload(
  userId: string,
  target: AttachmentTarget,
  upload: { id: string; name: string; type: string; size: number; role?: string | null },
): Promise<{ error: string | null }> {
  const checked = checkUpload(upload);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createTodoClient();
  const path = storagePathFor(userId, upload.id);

  const { data: found } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { search: upload.id, limit: 1 });
  if (!found || !found.some((f) => f.name === upload.id)) {
    return { error: 'The file did not arrive. Try uploading it again.' };
  }

  const role: AttachmentRole = isRole(upload.role)
    ? upload.role
    : guessRole(checked.name, checked.mimeType);
  const { error } = await supabase.from('attachments').insert({
    id: upload.id,
    user_id: userId,
    kind: 'file',
    role,
    name: checked.name,
    mime_type: checked.mimeType,
    size_bytes: upload.size,
    storage_path: path,
  });
  if (error) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
    return { error: 'The file could not be saved.' };
  }
  return linkAttachment(upload.id, target);
}

/** Puts an attachment that exists on another task or event. Already there is not an error. */
export async function linkAttachment(
  attachmentId: string,
  target: AttachmentTarget,
  client?: TodoSupabaseClient,
): Promise<{ error: string | null }> {
  const supabase = client ?? (await createTodoClient());
  const { error } = await supabase
    .from('attachment_links')
    .insert({ attachment_id: attachmentId, [targetColumn(target)]: target.id });
  if (error && error.code !== '23505') return { error: 'That could not be attached.' };
  return { error: null };
}

/**
 * Takes an attachment off a task or event. When nothing else holds it, the
 * attachment and its file go too, since storage does not cascade with rows.
 * Files that came out of an email are separate attachments and stay until
 * they are removed themselves.
 */
export async function removeFromTarget(
  attachmentId: string,
  target: AttachmentTarget,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();
  const { error } = await supabase
    .from('attachment_links')
    .delete()
    .eq('attachment_id', attachmentId)
    .eq(targetColumn(target), target.id);
  if (error) return { error: 'That could not be removed.' };

  const { count } = await supabase
    .from('attachment_links')
    .select('id', { count: 'exact', head: true })
    .eq('attachment_id', attachmentId);
  if ((count ?? 0) > 0) return { error: null };

  const { data: row } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .maybeSingle();
  const path = (row as { storage_path: string | null } | null)?.storage_path;
  await supabase.from('attachments').delete().eq('id', attachmentId);
  if (path) await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
  return { error: null };
}

export async function setRole(
  attachmentId: string,
  role: string,
): Promise<{ error: string | null }> {
  if (!isRole(role)) return { error: 'That is not a kind of attachment.' };
  const supabase = await createTodoClient();
  const { error } = await supabase.from('attachments').update({ role }).eq('id', attachmentId);
  return { error: error ? 'That could not be changed.' : null };
}

/** A short-lived address for one of the person's own files, or null when it is not theirs. */
export async function signedFileUrl(
  attachmentId: string,
  download: boolean,
): Promise<string | null> {
  const supabase = await createTodoClient();
  const { data: row } = await supabase
    .from('attachments')
    .select('storage_path, name')
    .eq('id', attachmentId)
    .eq('kind', 'file')
    .maybeSingle();
  const found = row as { storage_path: string | null; name: string } | null;
  if (!found?.storage_path) return null;
  const { data } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(found.storage_path, 120, download ? { download: found.name } : undefined);
  return data?.signedUrl ?? null;
}
