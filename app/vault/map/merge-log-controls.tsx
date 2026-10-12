'use client';

import { useState, useTransition } from 'react';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { FieldError, InlineInput } from '@/components/ui/field';
import { renameTheme, undoMerge } from './actions';
import { MERGE_NAME } from './merge-name';

/**
 * The two things a merge log row lets you do (plan #821): undo the merge, and
 * rename the theme it kept. Both are server actions that answer with an error
 * or null, and the page reloads its rows when one works.
 */

export function UndoMergeButton({ mergeId }: { mergeId: string }) {
  return (
    <ConfirmStep
      variant="secondary"
      confirmVariant="primary"
      confirmLabel="Undo merge"
      pendingLabel="Undoing…"
      prompt="Puts both sides back as they were. The map will not merge that pair again."
      onConfirm={async () => {
        const result = await undoMerge(mergeId);
        if (result.error) throw new Error(result.error);
      }}
    >
      Undo
    </ConfirmStep>
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
        className={`${MERGE_NAME} -ml-[5px]`}
      />
      {pending && <span className="block px-1 text-small text-ink-muted">Renaming…</span>}
      {error && <FieldError>{error}</FieldError>}
    </span>
  );
}
