import { AlertTriangle, GitBranch } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadConnection, loadSyncRuns } from '@/lib/vault/notes/load';
import { describeRun, syncProgress, type SyncProgress } from '@/lib/vault/sync/progress';
import { ConnectVaultForm } from './connect-form';
import { SyncNowButton } from './sync-now-button';
import { disconnectVault, rescanVault } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  active: 'Connected',
  needs_reauth: 'Needs reconnection',
  disconnected: 'Disconnected',
  error: 'Error',
};

export default async function VaultSettingsPage() {
  const supabase = await createVaultClient();
  const connection = await loadConnection(supabase);

  const [{ count }, runs] = await Promise.all([
    supabase.from('notes').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    connection ? loadSyncRuns(supabase) : Promise.resolve([]),
  ]);

  const progress = connection
    ? syncProgress({
        mirrored: count ?? 0,
        backfillCompletedAt: connection.backfillCompletedAt,
        runs,
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Vault settings"
        description="Where your notes come from, and how they get here."
      />

      {!connection ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect your vault</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-body leading-relaxed text-ink-muted">
              Keep your Obsidian vault in a private GitHub repository — the{' '}
              <strong className="font-medium text-ink">Obsidian Git</strong> plugin will commit and
              push it on a schedule — and this mirrors every markdown file in it. Images, PDFs and
              other attachments are never requested, so they never leave your machine.
            </p>
            <ConnectVaultForm submitLabel="Connect vault" />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader className="flex items-start justify-between gap-3">
              <CardTitle>
                {connection.repoOwner}/{connection.repoName}
              </CardTitle>
              {connection.status === 'active' ? (
                <span className="shrink-0 text-small text-ink-muted">
                  {STATUS_LABEL[connection.status]}
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-caution-tint px-2 py-0.5 text-small font-medium text-caution">
                  <AlertTriangle className="size-3" strokeWidth={2} aria-hidden />
                  {STATUS_LABEL[connection.status] ?? connection.status}
                </span>
              )}
            </CardHeader>
            <CardBody className="space-y-3">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-ui">
                <dt className="text-ink-muted">Branch</dt>
                <dd className="flex items-center gap-1 text-ink">
                  <GitBranch className="size-3.5 text-ink-muted" strokeWidth={2} aria-hidden />
                  {connection.branch}
                </dd>

                {connection.subpath && (
                  <>
                    <dt className="text-ink-muted">Folder</dt>
                    <dd className="text-ink">{connection.subpath}</dd>
                  </>
                )}

                <dt className="text-ink-muted">Notes</dt>
                <dd className="tabular text-ink">{count ?? 0}</dd>

                <dt className="text-ink-muted">Last synced</dt>
                <dd className="text-ink">
                  {connection.lastSyncedAt ? formatWhen(connection.lastSyncedAt) : 'Not yet'}
                </dd>
              </dl>

              {progress && <SyncProgressBar progress={progress} />}

              {connection.lastError && (
                <p className="rounded-lg bg-caution-tint px-3 py-2 text-ui text-ink">
                  Last run reported: {connection.lastError}
                </p>
              )}

              {runs.length > 0 && (
                <details className="rounded-lg border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-ui text-ink-muted">
                    Recent runs
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {runs.map((run) => (
                      <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                        <span className="w-24 text-small font-medium text-ink">
                          {run.type === 'backfill' ? 'First sync' : 'Update'}
                        </span>
                        <span className="tabular w-32 text-small text-ink-muted">
                          {run.startedAt ? formatWhen(run.startedAt) : '—'}
                        </span>
                        <span
                          className={
                            run.status === 'failed'
                              ? 'flex-1 text-small text-caution'
                              : 'flex-1 text-small text-ink-muted'
                          }
                        >
                          {describeRun(run)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <p className="text-ui text-ink-muted">
                Syncing runs once a day, on the same schedule as the mailbox. Press Sync now to
                pull anything you have pushed since.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <SyncNowButton active={progress?.phase === 'running'} />
                <form action={rescanVault}>
                  <input type="hidden" name="id" value={connection.id} />
                  <Button type="submit" variant="secondary">
                    Re-read everything
                  </Button>
                </form>
                <form action={disconnectVault}>
                  <input type="hidden" name="id" value={connection.id} />
                  <Button type="submit" variant="secondary">
                    Disconnect
                  </Button>
                </form>
              </div>
              <p className="text-ui text-ink-muted">
                Re-reading walks the whole tree again and re-fetches only what actually changed.
                Disconnecting removes this copy of your notes; your vault itself is untouched.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {connection.status === 'needs_reauth' ? 'Reconnect' : 'Update the connection'}
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {connection.status === 'needs_reauth' && (
                <p className="text-body leading-relaxed text-ink-muted">
                  Fine-grained tokens expire — a year at most — so this is routine rather than a
                  fault. Generate a new one with <strong>Contents: Read-only</strong> and paste it
                  below. Your notes and sync position are kept, so nothing is re-read.
                </p>
              )}
              <ConnectVaultForm
                defaults={{
                  repo: `${connection.repoOwner}/${connection.repoName}`,
                  branch: connection.branch,
                  subpath: connection.subpath,
                }}
                submitLabel="Save connection"
              />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * The bar, and the one sentence under it.
 *
 * A percentage on its own is not the feedback that was asked for: "62%" of an
 * unknown number says nothing. The counts go under it, and where a total is
 * genuinely unknown -- a vault whose first run has not finished walking the
 * tree -- the bar is left off rather than filled in with a guess.
 */
function SyncProgressBar({ progress }: { progress: SyncProgress }) {
  const tone =
    progress.phase === 'failed'
      ? 'bg-caution-fill'
      : progress.phase === 'up_to_date'
        ? 'bg-status-offer'
        : 'bg-accent';

  return (
    <div className="rounded-lg bg-canvas px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui font-medium text-ink">{progress.headline}</span>
        {progress.percent !== null && (
          <span className="tabular text-small text-ink-muted">{progress.percent}%</span>
        )}
      </div>

      {progress.percent !== null && (
        <div
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Vault sync progress"
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${tone}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}

      <p className="mt-1.5 text-small text-ink-muted">{progress.detail}</p>
    </div>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
