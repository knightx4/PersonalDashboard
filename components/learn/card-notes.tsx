'use client';

import { useState, useTransition } from 'react';
import { NotebookPen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { MAX_NOTE, type CardNote, type NoteWrite } from '@/lib/learn/notes/notes';

/**
 * Your notes on a Learn card or on an idea's page, and the box to add one
 * (plan #1058).
 *
 * On a card (`cardId` set) the list carries the notes written on it and the
 * ones on its idea from anywhere else, and says which are from elsewhere. On
 * the idea's page (`cardId` null) it carries every note on the idea.
 *
 * The box stays folded behind "Add a note" until pressed, so a card with no
 * notes gains one button and nothing else.
 */
export function CardNotes({
  id,
  cardId,
  notes: initial,
  add,
  remove,
  titled = true,
  className,
}: {
  /** Unique on the page: the textarea's id is built from it. */
  id: string;
  cardId: string | null;
  notes: readonly CardNote[];
  add: (body: string) => Promise<NoteWrite>;
  remove: (noteId: string) => Promise<{ error?: string }>;
  /** False where the section around it already says "Your notes". */
  titled?: boolean;
  className?: string;
}) {
  const [notes, setNotes] = useState<CardNote[]>([...initial]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [keeping, startKeep] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  const keep = () =>
    startKeep(async () => {
      setError(null);
      const result = await add(draft).catch(() => ({
        error: 'That note was not kept. Check your connection.',
        note: undefined,
      }));
      if (result.note) {
        setNotes((current) => [...current, result.note!]);
        setDraft('');
        setOpen(false);
      } else setError(result.error ?? 'That note was not kept.');
    });

  const drop = async (noteId: string) => {
    setError(null);
    setRemoving(noteId);
    const result = await remove(noteId).catch(() => ({
      error: 'That note was not deleted. Check your connection.',
    }));
    setRemoving(null);
    if (result.error) setError(result.error);
    else setNotes((current) => current.filter((note) => note.id !== noteId));
  };

  const fieldId = `note-${id}`;

  return (
    <section className={className} aria-label="Your notes">
      {notes.length > 0 && (
        <>
          {titled && <h3 className="text-small font-semibold text-ink-muted">Your notes</h3>}
          <ul className={cn('space-y-2', titled && 'mt-1.5')}>
            {notes.map((note) => {
              const from = elsewhere(note, cardId);
              return (
                <li
                  key={note.id}
                  className="flex items-start gap-2 rounded-control bg-sunken px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-body break-words whitespace-pre-line text-ink">
                      {note.body}
                    </p>
                    {from && <p className="mt-0.5 text-small text-ink-muted">{from}</p>}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void drop(note.id)}
                    pending={removing === note.id}
                    aria-label="Delete this note"
                    className="shrink-0"
                  >
                    <X className="size-3.5" strokeWidth={2} aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {open ? (
        <div className={cn(notes.length > 0 && 'mt-3')}>
          <Field label="A note" id={fieldId} hint="Kept on this idea, wherever it comes up again.">
            <Textarea
              id={fieldId}
              rows={3}
              maxLength={MAX_NOTE}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={keeping}
              autoFocus
            />
          </Field>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={keep}
              pending={keeping}
              disabled={draft.trim() === ''}
            >
              {keeping ? 'Keeping…' : 'Keep note'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={keeping}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className={cn(notes.length > 0 && 'mt-2')}
        >
          <NotebookPen className="size-3.5" strokeWidth={2} aria-hidden />
          Add a note
        </Button>
      )}

      {error && <p className="mt-2 text-small text-danger">{error}</p>}
    </section>
  );
}

/** Where a note came from, when it was not written where it is being read. */
function elsewhere(note: CardNote, cardId: string | null): string | null {
  if (cardId === null) return note.cardId ? 'Written on a card' : null;
  if (note.cardId === cardId) return null;
  return note.cardId ? 'Written on another card about this idea' : "Written on this idea's page";
}
