import 'server-only';

import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import { decryptAccessToken, vaultPortsFor } from '@/lib/vault/db/ports';
import { VaultAuthError } from '@/lib/vault/providers';
import { runVaultSync, type VaultConnectionRow } from '@/lib/vault/sync/run';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * The scheduled vault sync: every connected vault, once per cron tick.
 *
 * Deliberately not a chain of hand-offs. A run that stops early has already
 * written down where to continue, so the next tick picks it up -- the cron is
 * the retry, and there is nothing to keep alive between invocations.
 *
 * One vault's failure does not touch another's. A user whose token expired
 * six weeks ago must not be the reason everybody else stops syncing.
 */

/**
 * Written out rather than assembled from parts: supabase-js reads the literal
 * to type the result, and a concatenated string types as an error instead.
 */
const CONNECTION_COLUMNS =
  'id, user_id, repo_owner, repo_name, branch, subpath, access_token, sync_cursor, backfill_after_path, backfill_commit_sha, backfill_completed_at' as const;

type ConnectionWithToken = VaultConnectionRow & { access_token: string | null };

export type VaultSyncSummary = {
  connections: number;
  synced: number;
  notesWritten: number;
  notesDeleted: number;
  failed: Array<{ connectionId: string; error: string }>;
};

export async function runVaultSyncForAll(): Promise<VaultSyncSummary> {
  const supabase = createVaultServiceSupabase();

  const { data, error } = await supabase
    .from('vault_connections')
    .select(CONNECTION_COLUMNS)
    .eq('status', 'active');

  if (error) throw new Error(`Listing vault connections failed: ${error.message}`);

  const connections = (data ?? []) as ConnectionWithToken[];
  const summary: VaultSyncSummary = {
    connections: connections.length,
    synced: 0,
    notesWritten: 0,
    notesDeleted: 0,
    failed: [],
  };

  for (const connection of connections) {
    try {
      const result = await syncOneConnection(supabase, connection);
      summary.synced += 1;
      summary.notesWritten += result.notesWritten;
      summary.notesDeleted += result.notesDeleted;
    } catch (err) {
      summary.failed.push({
        connectionId: connection.id,
        error: err instanceof Error ? err.message : 'failed',
      });
    }
  }

  return summary;
}

/**
 * One vault, start to finish, with the run recorded either way.
 *
 * The sync_runs row is written even when the sync throws. A vault that stopped
 * syncing silently is the failure mode worth engineering against -- six weeks
 * of "up to date" that was nothing of the kind.
 */
export async function syncOneConnection(
  supabase: VaultSupabaseClient,
  connection: ConnectionWithToken,
) {
  if (!connection.access_token) {
    await markNeedsReauth(supabase, connection.id, 'No access token stored.');
    throw new Error('Vault connection has no access token.');
  }

  const { data: runRow, error: runError } = await supabase
    .from('sync_runs')
    .insert({
      connection_id: connection.id,
      type: connection.backfill_completed_at ? 'incremental' : 'backfill',
      status: 'running',
      from_sha: connection.sync_cursor,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (runError) throw new Error(`Starting a vault sync run failed: ${runError.message}`);
  const runId = (runRow as { id: string }).id;

  try {
    const ports = vaultPortsFor({
      supabase,
      connection,
      accessToken: decryptAccessToken(connection.access_token),
    });

    const result = await runVaultSync({ connection, ports });

    await supabase
      .from('sync_runs')
      .update({
        // A run that stopped early did real work and will be continued by the
        // next tick. Calling that "failed" would be a lie that reads as one.
        status: 'completed',
        to_sha: result.toSha,
        notes_seen: result.notesSeen,
        notes_written: result.notesWritten,
        notes_deleted: result.notesDeleted,
        notes_skipped: result.notesSkipped,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);

    await supabase
      .from('vault_connections')
      .update({ last_error: null })
      .eq('id', connection.id);

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed';

    await supabase
      .from('sync_runs')
      .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
      .eq('id', runId);

    if (err instanceof VaultAuthError) {
      await markNeedsReauth(supabase, connection.id, message);
    } else {
      await supabase
        .from('vault_connections')
        .update({ last_error: message })
        .eq('id', connection.id);
    }

    throw err;
  }
}

/**
 * A fine-grained PAT expires where a refresh token does not, so this is a
 * normal end state rather than an exceptional one. Saying so is the whole
 * point: a vault that quietly stopped syncing is worse than one that asks to
 * be reconnected.
 */
async function markNeedsReauth(
  supabase: VaultSupabaseClient,
  connectionId: string,
  message: string,
) {
  await supabase
    .from('vault_connections')
    .update({ status: 'needs_reauth', last_error: message })
    .eq('id', connectionId);
}
