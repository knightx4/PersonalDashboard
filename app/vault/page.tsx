import Link from 'next/link';
import { FileText, FolderTree, Search } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { createVaultClient } from '@/lib/vault/auth/server';
import { groupByFolder, loadConnection, loadNotes } from '@/lib/vault/notes/load';
import { VaultStatusBanner } from '@/components/vault/status-banner';

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
    return (
      <>
        <PageHeader title="Vault" description="Your Obsidian notes, mirrored here." />
        <EmptyState
          icon={FolderTree}
          title="No vault connected"
          description="Point this at the GitHub repository your Obsidian vault lives in and it will mirror every markdown file — and nothing else. Images, PDFs and attachments are never fetched."
          action={{ label: 'Connect a vault', href: '/vault/settings' }}
        />
      </>
    );
  }

  const notes = await loadNotes(supabase, search ? { search } : {});
  const groups = groupByFolder(notes);

  return (
    <>
      <PageHeader
        title="Vault"
        description={`${connection.repoOwner}/${connection.repoName} · ${connection.branch}`}
      />

      <VaultStatusBanner connection={connection} />

      <form className="mb-5" role="search">
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            strokeWidth={2}
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search your notes"
            aria-label="Search your notes"
            className="pl-9"
          />
        </div>
      </form>

      {notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={search ? 'Nothing matched' : 'No notes yet'}
          description={
            search
              ? `Nothing in the vault matches “${search}”. Search covers note titles and their full text.`
              : 'The first sync runs on the daily schedule. You can start one now from settings.'
          }
          action={search ? { label: 'Clear the search', href: '/vault' } : undefined}
          secondaryAction={search ? undefined : { label: 'Vault settings', href: '/vault/settings' }}
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
            {search ? ` matching “${search}”` : ''}
          </p>

          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.folder || '(root)'}>
                <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-muted">
                  <FolderTree className="size-3.5" strokeWidth={2} aria-hidden />
                  {group.folder || 'Vault root'}
                </h2>
                <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                  {group.notes.map((note) => (
                    <li key={note.id}>
                      <Link
                        href={`/vault/n/${note.path.split('/').map(encodeURIComponent).join('/')}`}
                        className="block px-4 py-3 transition-colors duration-150 hover:bg-canvas"
                      >
                        <span className="block text-sm font-medium text-ink">{note.title}</span>
                        {note.excerpt && (
                          <span className="mt-0.5 block truncate text-[13px] text-ink-muted">
                            {note.excerpt}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
