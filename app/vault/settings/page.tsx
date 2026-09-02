import { AlertTriangle, Check, GitBranch } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadConnection } from '@/lib/vault/notes/load';
import { ConnectVaultForm } from './connect-form';
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

  const { count } = await supabase
    .from('notes')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null);

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
            <p className="text-sm leading-relaxed text-ink-muted">
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
              <span
                className={
                  connection.status === 'active'
                    ? 'inline-flex items-center gap-1 rounded-full bg-positive-tint px-2 py-0.5 text-[12px] font-medium text-positive'
                    : 'inline-flex items-center gap-1 rounded-full bg-accent-orange-tint px-2 py-0.5 text-[12px] font-medium text-accent-orange'
                }
              >
                {connection.status === 'active' ? (
                  <Check className="size-3" strokeWidth={2.5} aria-hidden />
                ) : (
                  <AlertTriangle className="size-3" strokeWidth={2.5} aria-hidden />
                )}
                {STATUS_LABEL[connection.status] ?? connection.status}
              </span>
            </CardHeader>
            <CardBody className="space-y-3">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-ink-muted">Branch</dt>
                <dd className="flex items-center gap-1 text-ink">
                  <GitBranch className="size-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
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

                <dt className="text-ink-muted">First sync</dt>
                <dd className="text-ink">
                  {connection.backfillCompletedAt ? 'Complete' : 'Still working through the vault'}
                </dd>
              </dl>

              {connection.lastError && (
                <p className="rounded-lg bg-accent-orange-tint px-3 py-2 text-[13px] text-ink">
                  Last run reported: {connection.lastError}
                </p>
              )}

              <p className="text-[13px] text-ink-muted">
                Syncing runs once a day, on the same schedule as the mailbox. There is nothing to
                press — this page is here to tell you when something is wrong.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
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
              <p className="text-[13px] text-ink-muted">
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
                <p className="text-sm leading-relaxed text-ink-muted">
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

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
