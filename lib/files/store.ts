import 'server-only';

import type { DevComment } from '@/lib/comments/load';
import { loadThread } from '@/lib/thread/store';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import {
  DOC_COLUMNS,
  LISTING_COLUMNS,
  VERSION_COLUMNS,
  toDoc,
  toListing,
  toVersion,
  type DocRow,
  type FileDoc,
  type FileListing,
  type FileVersion,
  type ListingRow,
  type VersionRow,
} from './files';

/**
 * Reading files through the person's own session. Row level security limits
 * every read to their own files; nothing here passes a user id.
 */

/** Every live file, most recently changed first. */
export async function loadFiles(core: CoreSupabaseClient): Promise<FileListing[]> {
  const { data, error } = await core
    .from('files')
    .select(LISTING_COLUMNS)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Could not read your files: ${error.message}`);
  return ((data ?? []) as ListingRow[]).map(toListing);
}

/** One live file, or null when it is not one of yours or has been archived. */
export async function loadFile(core: CoreSupabaseClient, id: string): Promise<FileDoc | null> {
  const { data, error } = await core
    .from('files')
    .select(DOC_COLUMNS)
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Could not read the file: ${error.message}`);
  return data ? toDoc(data as DocRow) : null;
}

/** Every version of a file, newest first. */
export async function loadVersions(core: CoreSupabaseClient, id: string): Promise<FileVersion[]> {
  const { data, error } = await core
    .from('file_versions')
    .select(VERSION_COLUMNS)
    .eq('file_id', id)
    .order('version', { ascending: false });
  if (error) throw new Error(`Could not read the file's versions: ${error.message}`);
  return ((data ?? []) as VersionRow[]).map(toVersion);
}

/** The body of one earlier version, or null when there is no such version. */
export async function loadVersionBody(
  core: CoreSupabaseClient,
  id: string,
  version: number,
): Promise<{ title: string; body: string } | null> {
  const { data, error } = await core
    .from('file_versions')
    .select('title, body')
    .eq('file_id', id)
    .eq('version', version)
    .maybeSingle();
  if (error) throw new Error(`Could not read that version: ${error.message}`);
  return (data as { title: string; body: string } | null) ?? null;
}

/** The named live files, by id, for the links that point at them. */
export async function loadListingsById(
  core: CoreSupabaseClient,
  ids: readonly string[],
): Promise<Map<string, FileListing>> {
  const byId = new Map<string, FileListing>();
  if (ids.length === 0) return byId;
  const { data, error } = await core
    .from('files')
    .select(LISTING_COLUMNS)
    .in('id', [...new Set(ids)])
    .is('archived_at', null);
  if (error) throw new Error(`Could not read the linked files: ${error.message}`);
  for (const row of (data ?? []) as ListingRow[]) byId.set(row.id, toListing(row));
  return byId;
}

/**
 * Mark a file read (plan #1861): its newest version has been opened. Only an
 * unread file is written, so opening it again changes nothing, and the
 * trigger keeps updated_at as it was (migration 0203), so the file does not
 * move in the list. True when it was unread until now.
 */
export async function markFileRead(core: CoreSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await core
    .from('files')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(`Could not mark the file read: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Your files still to read, newest first: Dash's, with the current version unopened. */
export async function loadUnreadFiles(core: CoreSupabaseClient): Promise<FileListing[]> {
  const { data, error } = await core
    .from('files')
    .select(LISTING_COLUMNS)
    .eq('made_by', 'claude')
    .is('read_at', null)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Could not read which files are unread: ${error.message}`);
  return ((data ?? []) as ListingRow[]).map(toListing);
}

/**
 * The thread under a file, oldest first, kept under the file's ref in
 * core.conversations since plan #1470 (core.file_comments is read-only).
 */
export async function loadFileThread(
  core: CoreSupabaseClient,
  fileId: string,
): Promise<DevComment[]> {
  return loadThread(core, `core.files:${fileId}`);
}
