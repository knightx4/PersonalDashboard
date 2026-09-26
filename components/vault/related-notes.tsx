'use client';

import { Suspense, use } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import type { RelatedNoteLink } from '@/lib/vault/notes/related';

/**
 * "You wrote about this": up to two of your own vault notes beside a story, a
 * Learn card, a job or a goal (plan #1113, under #1110), each opening the
 * note. Nothing at all is drawn when there are none, so a page whose subject
 * you have not written about looks as it did before.
 *
 * `notes` may be a promise. The page starts the lookup and passes it down
 * unawaited, and this waits for it inside its own Suspense boundary, so the
 * rest of the page paints first and the notes stream in when they are found.
 * The fallback is nothing rather than a placeholder: most pages have no
 * related note, and a placeholder would promise one (law 2).
 *
 * The lookups are lib/news/quick/related-notes.ts and
 * lib/learn/feed/related-notes.ts, and on the role and goal pages the text
 * from lib/jobs/related-notes.ts and lib/goals/related-notes.ts (plan #1114),
 * all over lib/vault/notes/related.ts.
 * The similarity is not shown: the threshold already decided these are close,
 * and a percentage would claim more than it measures (law 3).
 */
export function RelatedNotes({
  notes,
  className,
}: {
  notes: readonly RelatedNoteLink[] | Promise<readonly RelatedNoteLink[]> | null | undefined;
  className?: string;
}) {
  if (!notes) return null;
  if (Array.isArray(notes)) return <RelatedNotesList notes={notes} className={className} />;
  return (
    <Suspense fallback={null}>
      <AwaitedNotes notes={notes as Promise<readonly RelatedNoteLink[]>} className={className} />
    </Suspense>
  );
}

function AwaitedNotes({
  notes,
  className,
}: {
  notes: Promise<readonly RelatedNoteLink[]>;
  className?: string;
}) {
  return <RelatedNotesList notes={use(notes)} className={className} />;
}

function RelatedNotesList({
  notes,
  className,
}: {
  notes: readonly RelatedNoteLink[];
  className?: string;
}) {
  if (notes.length === 0) return null;
  return (
    <section className={className}>
      <h3 className="text-small font-semibold text-ink-muted">You wrote about this</h3>
      <ul className="mt-1 space-y-0.5">
        {notes.map((note) => (
          <li key={note.noteId}>
            <Link
              href={note.href}
              className="inline-flex max-w-full items-baseline gap-1.5 text-ui text-accent hover:underline"
            >
              <FileText
                className="size-3.5 shrink-0 translate-y-0.5"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="break-words">{note.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
