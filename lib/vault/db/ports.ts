import 'server-only';

import { z } from 'zod';
import { decryptToken } from '@/lib/crypto/tokens';
import { createVaultSource } from '@/lib/vault/providers';
import type { KnownNotes } from '@/lib/vault/sync/plan';
import type { NoteWrite, VaultConnectionRow, VaultSyncPorts } from '@/lib/vault/sync/run';
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
      token: opts.accessToken,
    }),

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

/** The stored token, in usable form. Never logged, never returned to a client. */
export function decryptAccessToken(ciphertext: string): string {
  return decryptToken(ciphertext, encryptionKey());
}
