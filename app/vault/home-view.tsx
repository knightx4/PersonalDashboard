import Link from 'next/link';
import { FileText, FolderTree } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { EmptyState } from '@/components/ui/empty-state';
import type { NoteSummary, VaultConnectionSummary } from '@/lib/vault/notes/load';
import type { WeekConnection } from '@/lib/vault/notes/connections-load';
import { VaultStatusBanner } from '@/components/vault/status-banner';
import { NoteConnections } from '@/components/vault/note-connections';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

export type NoteFolderGroup = { folder: string; notes: NoteSummary[] };

/**
 * The note list, drawn from what the page read (page.tsx), so the gallery can
 * draw it from fixtures (plan #1605). `connection` null is a vault not yet
 * connected; `groups` are the notes by folder, in the order they render.
 */
export function VaultHomeView({
  connection,
  search,
  groups,
  connections,
}: {
  connection: VaultConnectionSummary | null;
  search: string;
  groups: NoteFolderGroup[];
  connections: readonly WeekConnection[];
}) {
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

  const noteCount = groups.reduce((sum, group) => sum + group.notes.length, 0);

  return (
    <>
      <PageHeader
        title="Vault"
        description={`${connection.repoOwner}/${connection.repoName} · ${connection.branch}`}
      />

      <VaultStatusBanner connection={connection} />

      {/* The note links in a connection are 44px tall on a phone, set here so
          NoteConnections stays as other pages draw it (plan #1605). */}
      <div className="[&_a]:press-area">
        <NoteConnections connections={connections} />
      </div>

      <div className="mb-5 max-w-md">
        <SearchField placeholder="Search your notes" />
      </div>

      {noteCount === 0 && search ? (
        <SearchEmpty query={search} />
      ) : noteCount === 0 ? (
        <EmptyState
          icon={FileText}
          title="No notes yet"
          description="The first sync runs on the daily schedule. You can start one now from settings."
          secondaryAction={{ label: 'Vault settings', href: '/vault/settings' }}
        />
      ) : (
        <>
          <p className="mb-3 text-body text-ink-muted">
            {noteCount} {noteCount === 1 ? 'note' : 'notes'}
            {search ? ` matching “${search}”` : ''}
          </p>

          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.folder || '(root)'}>
                <h2 className="mb-2 flex items-center gap-1.5 text-ui font-semibold text-ink-muted">
                  <FolderTree className="size-3.5" strokeWidth={2} aria-hidden />
                  {group.folder || 'Vault root'}
                </h2>
                <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
                  {group.notes.map((note) => (
                    <li key={note.id}>
                      <Link
                        href={`/vault/n/${note.path.split('/').map(encodeURIComponent).join('/')}`}
                        className="block px-4 py-3 transition-colors duration-quick hover:bg-canvas"
                      >
                        <span className="block text-body font-medium text-ink">{note.title}</span>
                        {note.excerpt && (
                          <span className="mt-0.5 block truncate text-ui text-ink-muted">
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
