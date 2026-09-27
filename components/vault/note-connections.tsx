'use client';

import Link from 'next/link';
import { FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { WeekConnection } from '@/lib/vault/notes/connections-load';
import type { RelatedNoteLink } from '@/lib/vault/notes/related';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { dismissNoteConnection } from '@/app/vault/actions';

/**
 * "This week in your notes" on the vault page (plan #1115, under #1110): up
 * to three of this week's notes that come back to an older note, each with
 * Dash's sentence on what they share and the notes named and linked. Written
 * by the Monday run (inngest/vault/note-connections.ts) and read by
 * lib/vault/notes/connections-load.ts.
 *
 * Nothing is drawn in a week with no connections, so a quiet week looks as
 * the page always did. Hiding one is optimistic: it goes at once, and comes
 * back with a toast if the write is refused. The similarity is not shown,
 * for the same reason as on RelatedNotes (law 3).
 */
export function NoteConnections({ connections }: { connections: readonly WeekConnection[] }) {
  const { shown, run } = useOptimisticWrite<readonly WeekConnection[], string>({
    value: connections,
    apply: (current, id) => current.filter((connection) => connection.id !== id),
    write: (id) => dismissNoteConnection(id),
  });
  if (shown.length === 0) return null;

  return (
    <CardSection
      className="mb-5"
      title="This week in your notes"
      hint="Notes you wrote in the last seven days that come back to something you wrote before."
    >
      <ul className="divide-y divide-border">
        {shown.map((connection) => (
          <li key={connection.id} className="flex items-start gap-2 py-2">
            <div className="min-w-0 flex-1">
              {connection.sentence && <p className="text-ui text-ink">{connection.sentence}</p>}
              <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-small', connection.sentence && 'mt-1')}>
                <span className="text-ink-muted">This week</span>
                {connection.recent.map((note) => (
                  <NoteLink key={note.noteId} note={note} />
                ))}
              </p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-small">
                <span className="text-ink-muted">Earlier</span>
                <NoteLink note={connection.older} />
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Hide this connection"
              title="Hide this connection"
              onClick={() => run(connection.id)}
            >
              <X className="size-3.5" strokeWidth={2} aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </CardSection>
  );
}

function NoteLink({ note }: { note: RelatedNoteLink }) {
  return (
    <Link href={note.href} className="inline-flex max-w-full items-baseline gap-1 text-accent hover:underline">
      <FileText className="size-3.5 shrink-0 translate-y-0.5" strokeWidth={1.75} aria-hidden />
      <span className="break-words">{note.title}</span>
    </Link>
  );
}
