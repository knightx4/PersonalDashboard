'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, InlineInput } from '@/components/ui/field';
import { renameTheme, undoMerge } from './actions';

/**
 * The two things a merge log row lets you do (plan #821): undo the merge, and
 * rename the theme it kept. Both are server actions that answer with an error
 * or null, and the page reloads its rows when one works.
 */

export function UndoMergeButton({ mergeId }: { mergeId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        pending={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await undoMerge(mergeId);
            if (result.error) setError(result.error);
          })
        }
      >
        {pending ? 'Undoing…' : 'Undo'}
      </Button>
      {error && <FieldError>{error}</FieldError>}
    </span>
  );
}

/**
 * The kept theme's name, editable where it stands (law 12). Saved on Enter or
 * when focus leaves; Escape puts the old name back.
 */
export function SurvivorName({ themeId, name }: { themeId: string; name: string }) {
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const next = value.trim();
    if (next === saved || pending) {
      setValue(saved);
      return;
    }
    start(async () => {
      setError(null);
      const result = await renameTheme(themeId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(next);
      setValue(next);
    });
  }

  return (
    <span className="block min-w-0">
      <InlineInput
        aria-label="Name of the theme this merge kept"
        value={value}
        disabled={pending}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setValue(saved);
            setError(null);
          }
        }}
        className="font-medium"
      />
      {pending && <span className="block px-1 text-small text-ink-muted">Renaming…</span>}
      {error && <FieldError>{error}</FieldError>}
    </span>
  );
}
