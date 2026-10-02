import 'server-only';

import { z } from 'zod';
import { decryptToken } from '@/lib/crypto/tokens';
import { ATTACHMENT_MAX_BYTES, VAULT_ATTACHMENTS_BUCKET, type AttachmentMimeType } from '@/lib/vault/paths';
import { createVaultSource } from '@/lib/vault/providers';
import type { AttachmentPlan, KnownAttachment, KnownAttachments } from '@/lib/vault/sync/attachments';
import type { SaveNotePorts, SavableNote } from '@/lib/vault/notes/save';
import type { KnownNotes } from '@/lib/vault/sync/plan';
import type {
  NoteWrite,
  VaultAttachmentPorts,
  VaultConnectionRow,
  VaultSyncPorts,
} from '@/lib/vault/sync/run';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * The database side of a sync.
 *
 * Everything here is the boring half -- reading rows, writing rows -- kept
 * apart from lib/vault/sync/run.ts so the decisions in that file can be tested
 * without a database and without a repository. This is the only module that
 * knows both a Supabase client and a vault source exist.
 */

const CHUNK = 500;

function encryptionKey(): string {
  return z.object({ TOKEN_ENCRYPTION_KEY: z.string().min(1) }).parse(process.env)
    .TOKEN_ENCRYPTION_KEY;
}

/**
 * What the mirror currently holds, keyed by vault path.
 *
 * Paged explicitly: PostgREST caps a response at a thousand rows by default,
 * and a vault is routinely larger than that. Reading a truncated map would
 * make the sync re-fetch notes it already has and, worse, believe notes it
 * simply did not read had been deleted upstream.
 */
export async function loadKnownNotes(
  supabase: VaultSupabaseClient,
  connectionId: string,
): Promise<KnownNotes> {
  const known = new Map<string, { blobSha: string; deleted: boolean }>();

  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('notes')
      .select('path, blob_sha, deleted_at')
      .eq('connection_id', connectionId)
      .order('path')
      .range(from, from + CHUNK - 1);

    if (error) throw new Error(`Reading the vault mirror failed: ${error.message}`);
    if (!data?.length) break;

    for (const row of data as Array<{ path: string; blob_sha: string; deleted_at: string | null }>) {
      known.set(row.path, { blobSha: row.blob_sha, deleted: row.deleted_at !== null });
    }

    if (data.length < CHUNK) break;
  }

  return known;
}

/** Every attachment row of a connection, keyed by vault path. Paged as notes are. */
export async function loadKnownAttachments(
  supabase: VaultSupabaseClient,
  connectionId: string,
): Promise<KnownAttachments> {
  const known = new Map<string, KnownAttachment>();

  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('attachments')
      .select('path, blob_sha, size_bytes, mime_type, storage_path')
      .eq('connection_id', connectionId)
      .order('path')
      .range(from, from + CHUNK - 1);

    if (error) throw new Error(`Reading vault attachments failed: ${error.message}`);
    if (!data?.length) break;

    for (const row of data as Array<{
      path: string;
      blob_sha: string;
      size_bytes: number | string;
      mime_type: AttachmentMimeType;
      storage_path: string | null;
    }>) {
      known.set(row.path, {
        blobSha: row.blob_sha,
        // bigint may come back as a string.
        sizeBytes: Number(row.size_bytes),
        mimeType: row.mime_type,
        storagePath: row.storage_path,
      });
    }

    if (data.length < CHUNK) break;
  }

  return known;
}

/**
 * Remove objects from the vault-attachments bucket, but only those no row of
 * the connection still points at. Copies are shared by content, so a file
 * deleted at one path may still be in use at another; the database is asked
 * rather than trusted from memory. Returns the paths it removed.
 */
export async function removeUnreferencedAttachmentObjects(
  supabase: VaultSupabaseClient,
  connectionId: string,
  storagePaths: string[],
): Promise<string[]> {
  const removed: string[] = [];

  for (let i = 0; i < storagePaths.length; i += CHUNK) {
    const slice = storagePaths.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('attachments')
      .select('storage_path')
      .eq('connection_id', connectionId)
      .in('storage_path', slice);
    if (error) throw new Error(`Checking attachment copies failed: ${error.message}`);

    const inUse = new Set((data ?? []).map((row) => (row as { storage_path: string }).storage_path));
    const unused = slice.filter((path) => !inUse.has(path));
    if (!unused.length) continue;

    const { error: removeError } = await supabase.storage
      .from(VAULT_ATTACHMENTS_BUCKET)
      .remove(unused);
    if (removeError) throw new Error(`Removing attachment copies failed: ${removeError.message}`);
    removed.push(...unused);
  }

  return removed;
}

function attachmentPorts(
  supabase: VaultSupabaseClient,
  connection: VaultConnectionRow,
): VaultAttachmentPorts {
  return {
    load: () => loadKnownAttachments(supabase, connection.id),

    async applyRows(plan: AttachmentPlan) {
      // Moves first, so a rename keeps the row's id; then deletes; then the
      // upserts, which may reuse a path a move has just vacated.
      for (const move of plan.moves) {
        const { error } = await supabase
          .from('attachments')
          .update({ path: move.to })
          .eq('connection_id', connection.id)
          .eq('path', move.from);
        if (error) throw new Error(`Renaming ${move.from} failed: ${error.message}`);
      }

      for (let i = 0; i < plan.removes.length; i += CHUNK) {
        const { error } = await supabase
          .from('attachments')
          .delete()
          .eq('connection_id', connection.id)
          .in('path', plan.removes.slice(i, i + CHUNK));
        if (error) throw new Error(`Removing attachments failed: ${error.message}`);
      }

      for (let i = 0; i < plan.upserts.length; i += CHUNK) {
        const rows = plan.upserts.slice(i, i + CHUNK).map((row) => ({
          user_id: connection.user_id,
          connection_id: connection.id,
          path: row.path,
          blob_sha: row.blobSha,
          size_bytes: row.sizeBytes,
          mime_type: row.mimeType,
          storage_path: row.storagePath,
        }));
        const { error } = await supabase
          .from('attachments')
          .upsert(rows, { onConflict: 'connection_id,path' });
        if (error) throw new Error(`Writing attachments failed: ${error.message}`);
      }
    },

    async removeObjects(storagePaths: string[]) {
      await removeUnreferencedAttachmentObjects(supabase, connection.id, storagePaths);
    },

    async upload({ storagePath, mimeType, bytes }) {
      // upsert: a copy left by a run that died before recording it is simply
      // written again. The key is the content, so it is the same file.
      const { error } = await supabase.storage
        .from(VAULT_ATTACHMENTS_BUCKET)
        .upload(storagePath, bytes, { contentType: mimeType, upsert: true });
      if (error) throw new Error(`Uploading ${storagePath} failed: ${error.message}`);
    },

    async markCopied(blobSha: string, storagePath: string) {
      const { error } = await supabase
        .from('attachments')
        .update({ storage_path: storagePath })
        .eq('connection_id', connection.id)
        .eq('blob_sha', blobSha)
        .is('storage_path', null)
        .lte('size_bytes', ATTACHMENT_MAX_BYTES);
      if (error) throw new Error(`Recording the copy of ${blobSha} failed: ${error.message}`);
    },
  };
}

/**
 * Build the ports for one connection.
 *
 * The service-role client bypasses RLS, so every statement below filters by
 * connection or user explicitly. Nothing else will.
 */
export function vaultPortsFor(opts: {
  supabase: VaultSupabaseClient;
  connection: VaultConnectionRow;
  accessToken: string;
}): VaultSyncPorts {
  const { supabase, connection } = opts;

  return {
    source: createVaultSource({
      provider: 'github',
      repoOwner: connection.repo_owner,
      repoName: connection.repo_name,
      branch: connection.branch,
      subpath: connection.subpath,
      token: opts.accessToken,
    }),

    attachments: attachmentPorts(supabase, connection),

    loadKnownNotes: (connectionId) => loadKnownNotes(supabase, connectionId),

    async writeNotes(writes: NoteWrite[]) {
      // A rename moves the existing row rather than inserting a second one.
      // The upsert alone would leave the old path behind as a duplicate, and
      // the note would lose the id anything citing it depends on.
      for (const write of writes) {
        if (!write.previousPath) continue;
        const { error } = await supabase
          .from('notes')
          .update({ path: write.path })
          .eq('connection_id', connection.id)
          .eq('path', write.previousPath);
        if (error) throw new Error(`Renaming ${write.previousPath} failed: ${error.message}`);
      }

      for (let i = 0; i < writes.length; i += CHUNK) {
        const rows = writes.slice(i, i + CHUNK).map((write) => ({
          user_id: connection.user_id,
          connection_id: connection.id,
          path: write.path,
          title: write.title,
          body: write.body,
          frontmatter: write.frontmatter,
          blob_sha: write.blobSha,
          size_bytes: write.sizeBytes,
          git_updated_at: write.gitUpdatedAt,
          // A note that comes back after a bad commit is un-deleted in place,
          // keeping its id.
          deleted_at: null,
        }));

        const { error } = await supabase
          .from('notes')
          .upsert(rows, { onConflict: 'user_id,path' });
        if (error) throw new Error(`Writing notes failed: ${error.message}`);
      }
    },

    async softDelete(paths: string[]) {
      // Soft, always. If Obsidian Git pushes a commit that drops files, this
      // sync mirrors it faithfully -- and the app must never be the reason
      // something is gone.
      const deletedAt = new Date().toISOString();
      for (let i = 0; i < paths.length; i += CHUNK) {
        const { error } = await supabase
          .from('notes')
          .update({ deleted_at: deletedAt })
          .eq('connection_id', connection.id)
          .is('deleted_at', null)
          .in('path', paths.slice(i, i + CHUNK));
        if (error) throw new Error(`Removing notes failed: ${error.message}`);
      }
    },

    async saveProgress(progress) {
      const patch: Record<string, unknown> = {};
      if ('syncCursor' in progress) patch.sync_cursor = progress.syncCursor;
      if ('backfillAfterPath' in progress) patch.backfill_after_path = progress.backfillAfterPath;
      if ('backfillCommitSha' in progress) patch.backfill_commit_sha = progress.backfillCommitSha;
      if ('backfillCompletedAt' in progress) {
        patch.backfill_completed_at = progress.backfillCompletedAt;
      }
      if ('lastSyncedAt' in progress) patch.last_synced_at = progress.lastSyncedAt;
      if (!Object.keys(patch).length) return;

      const { error } = await supabase
        .from('vault_connections')
        .update(patch)
        .eq('id', connection.id);
      if (error) throw new Error(`Saving sync progress failed: ${error.message}`);
    },
  };
}

/**
 * The ports for saving an edited note (plan #1424), over the session client.
 *
 * RLS decides which note and which connection come back, so a path that is
 * not the viewer's reads as no note at all. The token is decrypted here and
 * goes no further than the source.
 */
export function noteSavePorts(opts: {
  supabase: VaultSupabaseClient;
  afterSave: (noteId: string) => void;
}): SaveNotePorts {
  const { supabase } = opts;

  return {
    async loadNote(path) {
      const { data, error } = await supabase
        .from('notes')
        .select('id, path, title, body, blob_sha')
        .eq('path', path)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error(`Reading ${path} failed: ${error.message}`);
      if (!data) return null;
      const row = data as {
        id: string;
        path: string;
        title: string;
        body: string;
        blob_sha: string;
      };
      const note: SavableNote = {
        id: row.id,
        path: row.path,
        title: row.title,
        body: row.body,
        blobSha: row.blob_sha,
      };
      return note;
    },

    async openSource() {
      const { data, error } = await supabase
        .from('vault_connections')
        .select('repo_owner, repo_name, branch, subpath, access_token, status')
        .maybeSingle();
      if (error) throw new Error(`Reading the vault connection failed: ${error.message}`);
      if (!data) return 'none';
      const row = data as {
        repo_owner: string;
        repo_name: string;
        branch: string;
        subpath: string;
        access_token: string | null;
        status: string;
      };
      if (row.status !== 'active' || !row.access_token) return 'reauth';
      return createVaultSource({
        provider: 'github',
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        branch: row.branch,
        subpath: row.subpath,
        token: decryptAccessToken(row.access_token),
      });
    },

    async storeNote(noteId, expectedBlobSha, row) {
      const { error } = await supabase
        .from('notes')
        .update({
          title: row.title,
          body: row.body,
          frontmatter: row.frontmatter,
          blob_sha: row.blobSha,
          size_bytes: row.sizeBytes,
          git_updated_at: row.gitUpdatedAt,
        })
        .eq('id', noteId)
        .eq('blob_sha', expectedBlobSha);
      if (error) throw new Error(`Storing the saved note failed: ${error.message}`);
    },

    afterSave: opts.afterSave,
  };
}

/** The stored token, in usable form. Never logged, never returned to a client. */
export function decryptAccessToken(ciphertext: string): string {
  return decryptToken(ciphertext, encryptionKey());
}
