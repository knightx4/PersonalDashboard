import 'server-only';

import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import { decryptAccessToken, vaultPortsFor } from '@/lib/vault/db/ports';
import { VaultAuthError } from '@/lib/vault/providers';
import { runVaultSync, type VaultConnectionRow } from '@/lib/vault/sync/run';
import { activeRun } from '@/lib/vault/sync/manual';
import type { SyncRunSummary } from '@/lib/vault/sync/progress';
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

/** The same list plus status, written out for the same reason. */
const CONNECTION_COLUMNS_WITH_STATUS =
  'id, user_id, repo_owner, repo_name, branch, subpath, access_token, sync_cursor, backfill_after_path, backfill_commit_sha, backfill_completed_at, status' as const;

/** What activeRun() needs to tell a live run from an abandoned row. */
const RUN_COLUMNS =
  'id, type, status, notes_seen, notes_written, notes_deleted, notes_skipped, started_at, finished_at, error' as const;

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
 * One user's vault, on demand.
 *
 * The nightly pass is the norm and this is the impatient path: connect a vault
 * at nine in the morning and waiting until tomorrow to see a single note is
 * not a reasonable answer. Same work, same run log, so a hand-started sync and
 * a scheduled one are indistinguishable afterwards -- which is the point.
 *
 * The service client is used here rather than in the route: this module is
 * inside the boundary that may bypass RLS, and every query below filters by
 * the user id the caller established from the session.
 */
export type ManualVaultSyncResult =
  | { started: false; reason: 'no_connection' | 'needs_reauth' | 'already_running' }
  | { started: true; run: Promise<void> };

export async function runVaultSyncForUser(userId: string): Promise<ManualVaultSyncResult> {
  const supabase = createVaultServiceSupabase();

  const { data } = await supabase
    .from('vault_connections')
    .select(CONNECTION_COLUMNS_WITH_STATUS)
    .eq('user_id', userId)
    .maybeSingle();

  const connection = data as (ConnectionWithToken & { status: string }) | null;
  if (!connection) return { started: false, reason: 'no_connection' };
  if (connection.status !== 'active') return { started: false, reason: 'needs_reauth' };

  const { data: runRows } = await supabase
    .from('sync_runs')
    .select(RUN_COLUMNS)
    .eq('connection_id', connection.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (activeRun((runRows ?? []) as unknown as SyncRunSummary[])) {
    return { started: false, reason: 'already_running' };
  }

  // Handed back rather than awaited: the caller decides whether to hold the
  // request open for it. A rejection is swallowed here because syncOneConnection
  // has already written the failure to sync_runs, and an unhandled rejection in
  // a background task would take the process down with it.
  return { started: true, run: syncOneConnection(supabase, connection).then(() => {}, () => {}) };
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
