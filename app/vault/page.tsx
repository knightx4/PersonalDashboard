import { createVaultClient } from '@/lib/vault/auth/server';
import { groupByFolder, loadConnection, loadNotes } from '@/lib/vault/notes/load';
import { loadWeekConnections } from '@/lib/vault/notes/connections-load';
import { VaultHomeView } from './home-view';

export const dynamic = 'force-dynamic';

/**
 * The note list.
 *
 * Grouped by folder and ordered by path, because a vault is a folder tree and
 * not a feed. It is also the honest ordering: a first sync has no dates for
 * most notes -- a git tree listing carries no timestamps, so only a note whose
 * frontmatter declares one gets a date until something changes it. Sorting a
 * whole vault by a mostly-null column would look arbitrary, and would look
 * like a bug rather than a limitation.
 */
export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = q?.trim() ?? '';

  const supabase = await createVaultClient();
  const connection = await loadConnection(supabase);

  if (!connection) {
    return <VaultHomeView connection={null} search={search} groups={[]} connections={[]} />;
  }

  // This week's connections sit above the list, and only when not searching.
  const [notes, connections] = await Promise.all([
    loadNotes(supabase, search ? { search } : {}),
    search ? Promise.resolve([]) : loadWeekConnections(supabase),
  ]);

  return (
    <VaultHomeView
      connection={connection}
      search={search}
      groups={groupByFolder(notes)}
      connections={connections}
    />
  );
}
