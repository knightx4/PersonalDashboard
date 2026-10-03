import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { OwlIcon } from '@/components/shell/owl-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { cardVariants } from '@/components/ui/card';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadThreads, MAYA_THREAD_LIMIT } from '@/lib/vault/maya/store';
import { mayaThreadHref } from '@/lib/vault/paths';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

/**
 * The Maya tab (plan #1286): every thread with Maya, the one most recently
 * opened or talked in first. Each row is the question, the note it is on, and
 * where you have got to when there is a summary yet.
 *
 * A thread opens from a note's Maya section; from #1289 Maya also opens some
 * after a sync, marked here as picked by Maya.
 */
export default async function MayaPage() {
  const threads = await loadThreads({ core: await createCoreClient(), vault: await createVaultClient() });

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

  return (
    <>
      <PageHeader title="Maya" />
      <p className="mb-3 text-body text-ink-muted">
        {threads.length} {threads.length === 1 ? 'thread' : 'threads'}, most recent first
        {threads.length === MAYA_THREAD_LIMIT && ` (the first ${MAYA_THREAD_LIMIT} are shown)`}
      </p>

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {threads.map((thread) => (
          <li key={thread.id}>
            <Link
              href={mayaThreadHref(thread.id)}
              className="flex items-baseline gap-4 px-4 py-3 transition-colors duration-quick hover:bg-canvas"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-ink">{thread.question}</span>
                <span className="mt-0.5 block truncate text-ui text-ink-muted">
                  {thread.summary ?? (thread.note ? `On ${thread.note.title}` : 'On a note no longer in the vault')}
                </span>
              </span>
              <span className="shrink-0 text-small tabular-nums text-ink-muted">
                {thread.origin === 'automatic' ? 'Maya picked · ' : ''}
                <time dateTime={thread.updatedAt}>{day(thread.updatedAt)}</time>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
