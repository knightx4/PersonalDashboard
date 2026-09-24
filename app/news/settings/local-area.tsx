'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { FieldError, InlineInput } from '@/components/ui/field';
import { setLocalArea } from './actions';

/**
 * The place the Local topic is about, edited where it is read (law 12): the
 * value is a button until pressed, the input commits on Enter or on leaving
 * it, and Escape puts it back. Emptying it clears the area.
 */
export function LocalAreaField({ area }: { area: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(area ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(area ?? '');
          setError(null);
          setEditing(true);
        }}
        className="group inline-flex items-center gap-1.5 text-left text-body"
        title="Change your local area"
      >
        {area ? (
          <span className="font-medium text-ink">{area}</span>
        ) : (
          <span className="text-ink-ghost">Not set. Press to name your city or area.</span>
        )}
        <Pencil
          className="size-3.5 shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
    );
  }

  const save = () => {
    const next = draft.trim();
    if (next === (area ?? '')) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setLocalArea(next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  };

  return (
    <span className="flex flex-wrap items-center gap-2">
      <InlineInput
        autoFocus
        value={draft}
        disabled={pending}
        maxLength={80}
        aria-label="Your local area"
        placeholder="Your city or area, like NYC"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            save();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
          }
        }}
      />
      <FieldError>{error}</FieldError>
    </span>
  );
}
