import { FolderTree } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { vaultWritable } from '@/lib/capture/vault';
import { createCoreClient } from '@/lib/core/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadConnection, loadInboxNotes } from '@/lib/vault/notes/load';
import { suggestedNotesForInbox } from '@/lib/vault/notes/related';
import { noteHref } from '@/lib/vault/paths';
import { QuickNoteTriage, type TriageNote } from './triage';

export const dynamic = 'force-dynamic';

const TRIAGE_CRUMBS = [
  { label: 'Vault', href: '/vault' },
  { label: 'Quick note triage', href: '/vault/triage' },
];

/**
 * Quick note triage (plan #1729, feature #1726): the quick notes waiting in
 * the vault's Inbox folder, each with up to three notes suggested for it by
 * meaning. Triage is the Inbox folder itself, so a note filed from here
 * leaves both at once, and one left for later is still in both.
 *
 * Whether the buttons are offered is asked of GitHub (vaultWritable), as the
 * capture box asks it; a token that can only read gets the reason instead.
 */
export default async function QuickNoteTriagePage() {
  const user = await requireUser();
  const supabase = await createVaultClient();
  const connection = await loadConnection(supabase);

  if (!connection) {
    return (
      <>
        <PageHeader crumbs={TRIAGE_CRUMBS} title="Quick note triage" />
        <EmptyState
          icon={FolderTree}
          title="No vault connected"
          description="Quick notes are kept in your vault's Inbox folder, so triage needs a vault to read them from."
          action={{ label: 'Connect a vault', href: '/vault/settings' }}
        />
      </>
    );
  }

  const [inbox, writable, core] = await Promise.all([
    loadInboxNotes(supabase),
    vaultWritable(user.id),
    createCoreClient(),
  ]);
  const suggested = await suggestedNotesForInbox(supabase, user.id, inbox, { core });

  const notes: TriageNote[] = inbox.map((note) => ({
    id: note.id,
    path: note.path,
    title: note.title,
    body: note.body,
    blobSha: note.blobSha,
    written: note.gitUpdatedAt ? formatDay(note.gitUpdatedAt) : null,
    href: noteHref(note.path),
    excerpt: note.excerpt,
    // The score is left behind: only the order says which is nearest (law 3).
    suggestions: (suggested.get(note.id) ?? []).map(({ path, title, href }) => ({
      path,
      title,
      href,
    })),
  }));

  return (
    <>
      <PageHeader crumbs={TRIAGE_CRUMBS} title="Quick note triage" />
      <QuickNoteTriage notes={notes} writable={writable} />
    </>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
