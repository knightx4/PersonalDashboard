import { createVaultClient } from '@/lib/vault/auth/server';
import { openConnectedSource } from '@/lib/vault/db/ports';
import { loadConnection, loadSyncRuns } from '@/lib/vault/notes/load';
import { checkWriteAccess, type WriteAccess } from '@/lib/vault/notes/write-access';
import { syncProgress } from '@/lib/vault/sync/progress';
import { VaultSettingsView } from './settings-view';
import { requireUser } from '@/lib/auth/server';
import { loadVaultRules } from '@/lib/vault/map/vault-rules';

export const metadata = { title: 'Vault settings' };
export const dynamic = 'force-dynamic';

export default async function VaultSettingsPage() {
  const supabase = await createVaultClient();
  const connection = await loadConnection(supabase);

  // The write check asks GitHub, so it runs beside the database reads rather
  // than after them. A connection that needs reconnecting is not asked: its
  // status already says the token is the problem.
  const user = await requireUser();
  const [{ count }, runs, writeAccess, rules] = await Promise.all([
    supabase.from('notes').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    connection ? loadSyncRuns(supabase) : Promise.resolve([]),
    connection?.status === 'active'
      ? checkWriteAccess(() => openConnectedSource(supabase))
      : Promise.resolve<WriteAccess>('reconnect'),
    loadVaultRules(supabase, user.id),
  ]);

  const progress = connection
    ? syncProgress({
        mirrored: count ?? 0,
        backfillCompletedAt: connection.backfillCompletedAt,
        runs,
      })
    : null;

  return (
    <VaultSettingsView
      connection={connection}
      count={count}
      runs={runs}
      writeAccess={writeAccess}
      progress={progress}
      rules={rules}
    />
  );
}
