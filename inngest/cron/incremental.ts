import { after } from 'next/server';

/**
 * The incremental-sync sweep, shared by both workspaces.
 *
 * The two halves of the app run the same loop over their own inboxes: find the
 * accounts that finished a backfill, start an incremental sync for each, and
 * pump it in the background so the request returns immediately. Only the
 * schema differs, and the schema is carried by the functions passed in -- so
 * the loop itself, including the "already running" and per-account failure
 * handling, is defined once.
 */
export type StartResult = { jobId: string; alreadyRunning: boolean } | { skipped: string };

export type SyncableAccount = { id: string; user_id: string };

export type IncrementalSyncSummary = {
  accounts: number;
  started: number;
  alreadyRunning: number;
  skipped: Array<{ accountId: string; reason: string }>;
};

export async function runIncrementalSync(opts: {
  origin: string;
  listAccounts: () => Promise<SyncableAccount[]>;
  start: (a: { userId: string; accountId: string; origin: string }) => Promise<StartResult>;
  pump: (a: {
    userId: string;
    accountId: string;
    jobId: string;
    origin: string;
    type?: 'incremental';
  }) => Promise<void>;
}): Promise<IncrementalSyncSummary> {
  const accounts = await opts.listAccounts();

  const started: string[] = [];
  const running: string[] = [];
  const skipped: Array<{ accountId: string; reason: string }> = [];

  for (const account of accounts) {
    const accountId = account.id;
    const userId = account.user_id;
    try {
      const result = await opts.start({ userId, accountId, origin: opts.origin });
      if ('skipped' in result) {
        skipped.push({ accountId, reason: result.skipped });
        continue;
      }
      if (result.alreadyRunning) {
        running.push(result.jobId);
        continue;
      }
      started.push(result.jobId);
      const jobId = result.jobId;
      after(() =>
        opts.pump({ userId, accountId, jobId, origin: opts.origin, type: 'incremental' }),
      );
    } catch (err) {
      skipped.push({
        accountId,
        reason: err instanceof Error ? err.message : 'failed',
      });
    }
  }

  return {
    accounts: accounts.length,
    started: started.length,
    alreadyRunning: running.length,
    skipped,
  };
}
