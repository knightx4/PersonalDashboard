'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { InlineInput } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { GOAL_ACCEPTANCE_MAX, GOAL_TITLE_MAX } from '@/lib/goals/tree';
import { editGoal } from '../actions';

/**
 * A goal's title or done-when at the head of its own page, editable where it
 * stands (note 3e11d846). The areas page already edits both inline; the goal's
 * own page drew them as plain text, so the place you read a goal was the one
 * place you could not change it.
 *
 * Pressed, the words become an input in the same face and size, saved on
 * blur or Enter and put back on Escape -- the role title's pattern. The
 * pencil shows at rest on a phone, where there is no hover to find it by.
 */
export function GoalHeadingField({
  goalId,
  field,
  value,
}: {
  goalId: string;
  field: 'title' | 'acceptance';
  value: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(value ?? '');
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isTitle = field === 'title';
  const face = isTitle
    ? 'font-display text-title tracking-tight text-ink sm:text-title'
    : 'text-body text-ink-muted sm:text-body';

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(shown);
          setEditing(true);
        }}
        className={cn('group inline-flex items-center gap-1.5 text-left', !shown && 'text-ink-ghost')}
        title={isTitle ? 'Edit the goal' : 'Edit when the goal is done'}
      >
        {shown || 'Add when it is done…'}
        <Pencil
          className={cn(
            'shrink-0 text-ink-muted transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100',
            isTitle ? 'size-4' : 'size-3.5',
          )}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
    );
  }

  const save = () => {
    const next = draft.trim();
    if ((isTitle && !next) || next === shown) {
      setEditing(false);
      return;
    }
    const previous = shown;
    setShown(next);
    setEditing(false);
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set('id', goalId);
      form.set(field, next);
      const result = await editGoal({}, form);
      if (result.error) {
        setShown(previous);
        setError(result.error);
      }
    });
  };

  return (
    <span className="flex flex-wrap items-center gap-2">
      <InlineInput
        autoFocus
        value={draft}
        disabled={pending}
        maxLength={isTitle ? GOAL_TITLE_MAX : GOAL_ACCEPTANCE_MAX}
        placeholder={isTitle ? undefined : 'Done when…'}
        aria-label={isTitle ? 'Goal' : 'When the goal is done'}
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
        className={face}
      />
      {error && <span className="text-small text-danger">{error}</span>}
    </span>
  );
}
