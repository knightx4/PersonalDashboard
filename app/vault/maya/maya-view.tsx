import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { OwlIcon } from '@/components/shell/owl-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { ListPage } from '@/components/patterns/list-detail';
import type { MayaThreadRow } from '@/lib/vault/maya/store';
import { mayaThreadHref } from '@/lib/vault/paths';

/**
 * Every thread with Maya, drawn from what the page read (page.tsx), so the
 * gallery can draw it from fixtures (plan #1605). `limit` is the most the
 * page reads, so a list that long says it may be cut.
 */
export function MayaListView({ threads, limit }: { threads: MayaThreadRow[]; limit: number }) {
  if (threads.length === 0) {
    return (
      <>
        <PageHeader title="Maya" />
        <EmptyState
          icon={OwlIcon}
          title="No threads with Maya yet"
          description="Maya is a thought partner for your notes. Open a note and ask Maya for its thoughts: it sets the note against your other notes and against what others have written on the same question, and gives up to three points. Each thought opens a thread here that you can answer."
          action={{ label: 'Open your notes', href: '/vault' }}
        />
      </>
    );
  }

  const lead = (thread: MayaThreadRow) =>
    thread.summary ?? (thread.note ? `On ${thread.note.title}` : 'On a note no longer in the vault');

  return (
    <ListPage
      header={<PageHeader title="Maya" />}
      foot={
        <>
          {threads.length} {threads.length === 1 ? 'thread' : 'threads'}, most recent first
          {threads.length === limit && ` (the first ${limit} are shown)`}
        </>
      }
    >
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            href={mayaThreadHref(thread.id)}
            className="card-pad-x row-pad flex min-h-11 items-baseline gap-4 transition-colors duration-quick hover:bg-sunken"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink">{thread.question}</span>
              <span className="mt-0.5 block truncate text-ui text-ink-muted">
                {thread.origin === 'automatic' ? `Maya picked · ${lead(thread)}` : lead(thread)}
              </span>
            </span>
            <time dateTime={thread.updatedAt} className="shrink-0 text-small tabular-nums text-ink-muted">
              {day(thread.updatedAt)}
            </time>
          </Link>
        </li>
      ))}
    </ListPage>
  );
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
