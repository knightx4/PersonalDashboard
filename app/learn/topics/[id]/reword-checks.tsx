'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { rewordLevel, type RewordState } from './actions';

/**
 * One level's checks on an approved topic, with Edit beside them (idea
 * b4bb9641). Edit turns the checks into a box, one a line; Save rewords the
 * level, which stamps it and keeps the drafted wording beside yours.
 * `defaultEditing` is how the gallery draws the box open.
 */

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" pending={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

export function RewordChecks({
  topicId,
  cellId,
  level,
  checks,
  defaultEditing = false,
}: {
  topicId: string;
  cellId: string;
  level: number;
  checks: readonly string[];
  defaultEditing?: boolean;
}) {
  const [editing, setEditing] = useState(defaultEditing);
  const [text, setText] = useState(checks.join('\n'));
  const [state, save] = useActionState<RewordState, FormData>(async (prev, formData) => {
    const result = await rewordLevel(prev, formData);
    if (result.saved) setEditing(false);
    return result;
  }, {});
  const fieldId = `reword-${level}`;

  if (!editing) {
    return (
      <>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ui text-ink">
          {checks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="absolute right-2 top-2"
          onClick={() => {
            setText(checks.join('\n'));
            setEditing(true);
          }}
          aria-label={`Edit the checks for level ${level}`}
        >
          Edit
        </Button>
      </>
    );
  }

  return (
    <form action={save} className="mt-1.5 space-y-2">
      <input type="hidden" name="topicId" value={topicId} />
      <input type="hidden" name="cellId" value={cellId} />
      {/* ui-ok: the page's whole job for a level is rewording it; the box opens only on Edit (idea b4bb9641) */}
      <Textarea
        id={fieldId}
        name="checks"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={Math.max(text.split('\n').length, 2)}
        aria-label={`Checks for level ${level}, one a line`}
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? `${fieldId}-error` : undefined}
        autoFocus
        className="min-h-0"
      />
      {state.error && (
        <p id={`${fieldId}-error`} role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <SaveButton />
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <span className="text-small text-ink-muted">Answers you gave before stay as they were.</span>
      </div>
    </form>
  );
}
