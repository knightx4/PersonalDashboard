'use client';

import { useActionState, useState } from 'react';
import { X } from 'lucide-react';
import { MainRail } from '@/components/patterns/main-rail';
import { PageHeader } from '@/components/shell/page-header';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button, PRESS_AREA } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldError, InlineInput, Input, PressLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { linkVariants } from '@/components/ui/link';
import { Stat } from '@/components/ui/stat';
import { Tooltip } from '@/components/ui/tooltip';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import {
  CUSTOM_FIELDS_MAX,
  CUSTOM_LABEL_MAX,
  customFieldErrors,
  DETAIL_KEYS,
  DETAIL_LABELS,
  DETAIL_MAX,
  linkedinHref,
  type CustomField,
  type DetailKey,
  type Details,
} from '@/lib/you/details';
import type { DetailsFormState } from './actions';

/** How each field is typed: the keyboard a phone offers and what the browser may fill in. */
const INPUT_PROPS: Partial<Record<DetailKey, React.ComponentProps<'input'>>> = {
  phone: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  linkedin_url: { inputMode: 'url', autoComplete: 'url', placeholder: 'linkedin.com/in/…' },
  citizenship: { autoComplete: 'off' },
  // Free text, since any list of options would leave someone out. Said in
  // the box rather than as a hint under each of the three (law 9).
  race: { autoComplete: 'off', placeholder: 'In your own words' },
  gender: { autoComplete: 'off', placeholder: 'In your own words' },
  sexuality: { autoComplete: 'off', placeholder: 'In your own words' },
};

/**
 * You's Details tab (plan #2124.2): the six facts a form asks for, read as a
 * list of answers, each "Not set" until given, and under them the fields the
 * person added of their own (plan #2531.2). One Edit turns the list into
 * fields in the same place (law 14), where an own field's name can be
 * changed where it stands and the field removed; Save puts the answers back.
 * Add a field opens a name box under the list, in the form. The rail says how
 * many of the six are set and who reads them.
 *
 * `save` is the server action, passed in so the gallery can draw the tab
 * without one; `editing`, `adding`, `revealRemove` and `state` let it draw the
 * form open, the name box open, a remove button held as on hover, and a
 * refused save. A refused save keeps what was typed and says why under it.
 */
export function DetailsView({
  details,
  save,
  editing: startEditing = false,
  adding: startAdding = false,
  revealRemove,
  state: startState = {},
}: {
  details: Details;
  save?: (prev: DetailsFormState, form: FormData) => Promise<DetailsFormState>;
  editing?: boolean;
  adding?: boolean;
  /** The id of an own field whose remove button shows as if pointed at. For the gallery. */
  revealRemove?: string;
  state?: DetailsFormState;
}) {
  const [state, action, pending] = useActionState(
    save ?? (async (prev: DetailsFormState) => prev),
    startState,
  );
  const [editing, setEditing] = useState(startEditing);
  const [adding, setAdding] = useState(startAdding);

  // Close the form once a save lands, adjusted during render rather than in
  // an effect (React's own pattern, and the one the lint rule leaves standing).
  const [seen, setSeen] = useState<DetailsFormState>(state);
  if (state !== seen) {
    setSeen(state);
    if (state.saved) setEditing(false);
  }

  const shown = state.saved ?? details;
  const setCount = DETAIL_KEYS.filter((key) => shown[key] !== null).length;
  const canAdd = shown.custom_fields.length < CUSTOM_FIELDS_MAX;

  const header = (
    <PageHeader
      subject={sectionSubject('/you/details', 'Details')}
      title="Details"
      actions={
        editing ? undefined : (
          <Button type="button" variant="secondary" size="md" onClick={() => setEditing(true)}>
            Edit details
          </Button>
        )
      }
    />
  );

  return (
    <MainRail
      main={
        <>
          {header}
          <Card padding="standard">
            {editing ? (
              <DetailsForm
                details={shown}
                state={state}
                action={action}
                pending={pending}
                adding={adding}
                setAdding={setAdding}
                revealRemove={revealRemove}
                onCancel={() => {
                  setEditing(false);
                  setAdding(false);
                }}
              />
            ) : (
              <div className="space-y-4">
                <ValueList className="space-y-3">
                  {DETAIL_KEYS.map((key) => (
                    <ValueRow
                      key={key}
                      label={DETAIL_LABELS[key]}
                      value={readValue(key, shown[key])}
                    />
                  ))}
                  {shown.custom_fields.map((field) => (
                    <ValueRow key={field.id} label={field.label} value={field.value} />
                  ))}
                </ValueList>
                {canAdd ? (
                  <AddTrigger
                    label="Add a field"
                    onClick={() => {
                      setEditing(true);
                      setAdding(true);
                    }}
                  />
                ) : null}
              </div>
            )}
          </Card>
        </>
      }
      rail={
        <Card padding="standard" className="space-y-3">
          <Stat value={`${setCount} of ${DETAIL_KEYS.length}`} label="details set" />
          <p className="text-small text-ink-muted">
            Dash reads all six, and any fields you add, when it answers you or works on your goals.
          </p>
        </Card>
      }
    />
  );
}

/** A detail as the list reads it: LinkedIn as a link, the rest as written. */
function readValue(key: DetailKey, value: string | null): React.ReactNode {
  if (value === null) return null;
  if (key === 'linkedin_url') {
    return (
      <a
        href={linkedinHref(value)}
        target="_blank"
        rel="noreferrer"
        className={cn(PRESS_AREA, linkVariants())}
      >
        {value}
      </a>
    );
  }
  return value;
}

function DetailsForm({
  details,
  state,
  action,
  pending,
  adding,
  setAdding,
  revealRemove,
  onCancel,
}: {
  details: Details;
  state: DetailsFormState;
  action: (form: FormData) => void;
  pending: boolean;
  adding: boolean;
  setAdding: (adding: boolean) => void;
  revealRemove?: string;
  onCancel: () => void;
}) {
  const errors = state.errors ?? {};
  const valueOf = (key: DetailKey) => state.values?.[key] ?? details[key] ?? '';
  return (
    <form
      key={state.values || state.fields ? JSON.stringify([state.values, state.fields]) : 'first'}
      action={action}
      className="space-y-5"
    >
      <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
        {DETAIL_KEYS.map((key) => (
          <Field key={key} id={`detail-${key}`} label={DETAIL_LABELS[key]} error={errors[key]}>
            <Input
              id={`detail-${key}`}
              name={key}
              defaultValue={valueOf(key)}
              maxLength={DETAIL_MAX[key]}
              {...INPUT_PROPS[key]}
            />
          </Field>
        ))}
      </div>
      <OwnFields
        initial={state.fields ?? details.custom_fields}
        adding={adding}
        setAdding={setAdding}
        revealRemove={revealRemove}
      />
      <p className="text-small text-ink-muted">Leave a field empty to clear it.</p>
      <FieldError>{state.error}</FieldError>
      {/* Held at the foot of a phone's screen, above the dock, so Save is in
          reach however many fields of their own the form has grown. */}
      <div
        className={cn(
          'flex flex-wrap items-center justify-end gap-2',
          'max-sm:sticky max-sm:bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] max-sm:z-over-link',
          'max-sm:-mx-(--card-p) max-sm:border-t max-sm:border-border max-sm:bg-surface max-sm:px-(--card-p) max-sm:py-2',
        )}
      >
        <Button type="button" variant="ghost" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="md" pending={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

/**
 * The fields of their own, inside the Details form (plan #2531.2). Each is
 * drawn as the six are, a name over a box, except that pressing the name
 * renames the field where it stands (law 12, OwnFieldName), with a remove
 * button beside it that shows when the field is pointed at or holds focus,
 * and always on a phone. Removing asks nothing: the field's text is still in
 * the form until Save, and Cancel brings it back.
 *
 * The list travels as one hidden `custom_fields` JSON value, so a Save
 * replaces the stored list with exactly what the form shows. An error shows
 * under the field it is about as soon as it is true.
 */
function OwnFields({
  initial,
  adding,
  setAdding,
  revealRemove,
}: {
  initial: CustomField[];
  adding: boolean;
  setAdding: (adding: boolean) => void;
  revealRemove?: string;
}) {
  const [fields, setFields] = useState<CustomField[]>(initial);
  const [name, setName] = useState('');
  const errors = customFieldErrors(fields);
  const nameTooLong = name.trim().length > CUSTOM_LABEL_MAX;
  const canAdd = fields.length < CUSTOM_FIELDS_MAX;

  const change = (id: string, patch: Partial<CustomField>) =>
    setFields((list) => list.map((field) => (field.id === id ? { ...field, ...patch } : field)));

  const add = () => {
    const label = name.trim();
    if (!label || nameTooLong || !canAdd) return;
    const id = crypto.randomUUID();
    setFields((list) => [...list, { id, label, value: '' }]);
    setName('');
    setAdding(false);
    // The new field's box takes the caret, so the value is typed next.
    requestAnimationFrame(() => document.getElementById(`own-${id}`)?.focus());
  };

  const closeNameBox = () => {
    setName('');
    setAdding(false);
  };

  return (
    <div className={cn('space-y-5', fields.length > 0 && 'border-t border-border pt-5')}>
      <input type="hidden" name="custom_fields" value={JSON.stringify(fields)} />
      {fields.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
          {fields.map((field) => {
            const error = errors[field.id];
            const errorId = error ? `own-${field.id}-error` : undefined;
            const shown = revealRemove === field.id;
            return (
              <div key={field.id} className="group/own min-w-0">
                <div className="mb-1 flex items-start gap-1">
                  <OwnFieldName
                    id={`own-${field.id}-name`}
                    label={field.label}
                    invalid={Boolean(error) && !field.label.trim()}
                    describedBy={errorId}
                    onChange={(label) => change(field.id, { label })}
                  />
                  <Tooltip
                    label="Remove this field"
                    align="end"
                    defaultOpen={shown}
                    className="shrink-0"
                  >
                    <IconButton
                      size="sm"
                      label={`Remove ${field.label.trim() || 'this field'}`}
                      onClick={() =>
                        setFields((list) => list.filter((other) => other.id !== field.id))
                      }
                      className={cn(
                        'sm:opacity-0 sm:group-hover/own:opacity-100 sm:group-focus-within/own:opacity-100 pointer-coarse:opacity-100',
                        shown && 'sm:opacity-100',
                      )}
                    >
                      <X strokeWidth={1.75} aria-hidden />
                    </IconButton>
                  </Tooltip>
                </div>
                <div className="relative">
                  <PressLabel htmlFor={`own-${field.id}`} />
                  <Input
                    id={`own-${field.id}`}
                    value={field.value}
                    onChange={(event) => change(field.id, { value: event.target.value })}
                    aria-label={field.label.trim() || 'Value of this field'}
                    aria-invalid={error && field.label.trim() ? true : undefined}
                    aria-describedby={errorId}
                    autoComplete="off"
                    className="relative"
                  />
                </div>
                <FieldError id={errorId}>{error}</FieldError>
              </div>
            );
          })}
        </div>
      ) : null}
      {adding && canAdd ? (
        // In the same two columns as the fields above, so the box is as wide as theirs.
        <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
          <div>
            <Field
              id="own-new-name"
              label="Name of the new field"
              error={
                nameTooLong ? `A name can be at most ${CUSTOM_LABEL_MAX} characters.` : undefined
              }
            >
              <Input
                id="own-new-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    add();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    closeNameBox();
                  }
                }}
                placeholder="Such as Frequent flyer number"
                autoComplete="off"
                autoFocus
              />
            </Field>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={add}
                disabled={!name.trim() || nameTooLong}
              >
                Add field
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={closeNameBox}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : canAdd ? (
        <AddTrigger label="Add a field" onClick={() => setAdding(true)} />
      ) : (
        <p className="text-small text-ink-muted">
          You can keep at most {CUSTOM_FIELDS_MAX} fields of your own.
        </p>
      )}
    </div>
  );
}

/**
 * An own field's name, which renames the field where it stands. At rest it is
 * text set as the six labels are, wrapping when long; pressed, it becomes a
 * box holding the name, 16px on a phone so iOS does not zoom the page, and
 * Enter, Escape or leaving it puts the text back. A field with no name shows
 * "Add a name" in the box's place, in the danger colour while that is what
 * stops the save.
 */
function OwnFieldName({
  id,
  label,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  label: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (label: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  if (renaming) {
    return (
      <div className="relative min-w-0 flex-1">
        <PressLabel htmlFor={id} />
        <InlineInput
          id={id}
          value={label}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          aria-label="Name of this field"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoFocus
          className="relative -ml-1 font-medium text-ink-muted sm:text-small"
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setRenaming(true)}
      aria-label={label.trim() ? `Rename ${label.trim()}` : 'Name this field'}
      aria-describedby={describedBy}
      className={cn(
        PRESS_AREA,
        'press -mx-1 min-w-0 flex-1 rounded-control px-1 text-left text-small font-medium [overflow-wrap:anywhere]',
        'transition-colors duration-quick hover:bg-sunken',
        invalid ? 'text-danger' : label.trim() ? 'text-ink-muted' : 'text-ink-ghost',
      )}
    >
      {label.trim() || 'Add a name'}
    </button>
  );
}
