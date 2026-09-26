'use client';

import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react';
import type { CollectionField, FieldValue } from '@/lib/goals/collections';
import { VALUE_PREFIX, displayValue, inputValue } from '@/lib/goals/information';
import { cn } from '@/lib/cn';
import { saveRecordAction, type InformationActionState } from './information-actions';
import { FieldInput } from './field-input';

const initial: InformationActionState = {};

/**
 * One value of a saved record, read as text and changed where it is read
 * (laws 12 and 14; plan #1040). Clicking the value turns it into its field's
 * input. Leaving the input or pressing Enter saves it when it changed, a
 * choice saves as soon as it is picked, and Escape puts the value back. The
 * save sends only this field, so the rest of the record is left as it is,
 * and a draft stays a draft until its own Confirm is pressed.
 */
export function RecordValue({
  stepId,
  recordId,
  field,
  value,
  needed,
  align = 'left',
  startEditing = false,
  inTable = false,
}: {
  stepId: string;
  recordId: string;
  field: CollectionField;
  value: FieldValue | undefined;
  /** An asked field with no value, which reads as Needed rather than Not set. */
  needed: boolean;
  align?: 'left' | 'right';
  /** Open with the input showing. A seam for the gallery; nothing in the app passes it. */
  startEditing?: boolean;
  /**
   * In a table cell. The input then takes the cell's width instead of setting
   * it: at its natural twenty characters it pushed a number column out by
   * half again as it opened, and every column after it moved.
   */
  inTable?: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [state, save, saving] = useActionState(
    async (prev: InformationActionState, form: FormData) => {
      const result = await saveRecordAction(prev, form);
      // In a transition, so the editor closes in the same commit as the
      // revalidated value. Set straight after the await, it was an urgent
      // update that closed first and showed the old value for a moment.
      if (!result.error) startTransition(() => setEditing(false));
      return result;
    },
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  // Set by Escape, so a blur fired as the input is taken away does not save
  // what Escape was pressed to throw away.
  const discarded = useRef(false);
  const id = useId();
  const before = inputValue(field, value);
  const shown = displayValue(field, value);
  const name = `${VALUE_PREFIX}${field.key}`;

  useEffect(() => {
    if (!editing) return;
    formRef.current
      ?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')
      ?.focus();
  }, [editing]);

  function commit() {
    const form = formRef.current;
    if (!form || saving || discarded.current) return;
    const now = String(new FormData(form).get(name) ?? '').trim();
    if (now === before.trim()) setEditing(false);
    else form.requestSubmit();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          discarded.current = false;
          setEditing(true);
        }}
        aria-label={shown ? `Change ${field.label}, now ${shown}` : `Fill in ${field.label}`}
        className={cn(
          'press -mx-1 max-w-full rounded-control px-1 [overflow-wrap:anywhere] hover:bg-sunken',
          align === 'right' ? 'text-right' : 'text-left',
        )}
      >
        {shown || (
          <span className={needed ? 'text-ink-muted' : 'text-ink-ghost'}>
            {needed ? 'Needed' : 'Not set'}
          </span>
        )}
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={save}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commit();
      }}
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement) commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          discarded.current = true;
          setEditing(false);
          return;
        }
        // A long text takes Enter as a new line and saves when left.
        if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) {
          event.preventDefault();
          commit();
        }
      }}
      // In a table the column keeps the width its values gave it; elsewhere
      // a floor stops a short value opening into a sliver of a box.
      className={inTable ? 'w-full min-w-20' : 'min-w-32'}
    >
      <input type="hidden" name="stepId" value={stepId} />
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="keepDraft" value="true" />
      <label htmlFor={id} className="sr-only">
        {field.label}
      </label>
      <FieldInput
        id={id}
        field={field}
        value={value}
        fit={inTable}
        className={align === 'right' ? 'tabular text-right' : undefined}
      />
      {state.error && <p className="mt-1 text-small text-danger">{state.error}</p>}
    </form>
  );
}
