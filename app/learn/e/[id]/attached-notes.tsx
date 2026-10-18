'use client';

import { useState, useTransition } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { vaultNoteHref, type AttachedNote } from '@/lib/learn/essays/vault-notes';
import { detachVaultNote } from './attached-actions';

/**
 * The vault notes attached to the essay's notes, on Prepare (attach_vault_note).
 * Update the map reads their text with the notes; Remove takes one off the
 * essay and leaves the note in the vault as it is. `merge` is the Merge with a
 * vault note button (merge-note-dialog.tsx), opposite the heading, so the card
 * is drawn with none attached too.
 */
export function AttachedNotesCard({
  essayId,
  initial,
  merge,
}: {
  essayId: string;
  initial: readonly AttachedNote[];
  merge?: React.ReactNode;
}) {
  const [notes, setNotes] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  if (notes.length === 0 && !merge) return null;

  const remove = (note: AttachedNote) =>
    start(async () => {
      const result = await detachVaultNote(essayId, note.id);
      if (!result.ok) {
        toast({ text: result.error });
        return;
      }
      setNotes((now) => now.filter((n) => n.id !== note.id));
    });

  return (
    <Card padding="none">
      <CardSection
        title="Vault notes"
        hint={notes.length > 0 ? 'Read with your notes when you update the map.' : undefined}
        action={merge}
      >
        {notes.length > 0 && (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={vaultNoteHref(note.path)}
                    className={cn(
                      'inline-flex min-h-11 items-center text-ui [overflow-wrap:anywhere] lg:min-h-8',
                      linkVariants(),
                    )}
                  >
                    {note.title}
                  </Link>
                  {note.why && <p className="text-small text-ink-muted">{note.why}</p>}
                </div>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => remove(note)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardSection>
    </Card>
  );
}
