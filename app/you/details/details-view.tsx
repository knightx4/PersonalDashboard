'use client';

import { useActionState, useId, useState } from 'react';
import { X } from 'lucide-react';
import { MainRail } from '@/components/patterns/main-rail';
import { PageHeader } from '@/components/shell/page-header';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button, PRESS_AREA } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldError, InlineInput, Input, PressLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { linkVariants } from '@/components/ui/link';
import { LinkedText } from '@/components/ui/linked-text';
import { Stat } from '@/components/ui/stat';
import { Tooltip } from '@/components/ui/tooltip';
import { ValueList } from '@/components/ui/value-row';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import {
  CUSTOM_FIELDS_MAX,
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
  full_name: { autoComplete: 'name' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  phone: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  mailing_address: { autoComplete: 'street-address', placeholder: 'As a letter would show it' },
  linkedin_url: { inputMode: 'url', autoComplete: 'url', placeholder: 'linkedin.com/in/…' },
  citizenship: { autoComplete: 'off' },
  // Free text, since any list of options would leave someone out. Said in
  // the box rather than as a hint under each of the three (law 9).
  race: { autoComplete: 'off', placeholder: 'In your own words' },
  gender: { autoComplete: 'off', placeholder: 'In your own words' },
  sexuality: { autoComplete: 'off', placeholder: 'In your own words' },
};

/**
 * You's Details tab (plan #2124.2): the facts a form asks for, read as a
 * list of answers, each "Not set" until given, and under them the fields the
 * person added of their own (plan #2531.2). One Edit turns the list into
 * fields in the same place (law 14), where an own field's name can be
 * changed where it stands and the field removed; Save puts the answers back.
 * Add a field puts a new row in the form with the caret in its name. The rail
 * says how many of them are set and who reads them, once any is.
 *
 * `save` is the server action, passed in so the gallery can draw the tab
 * without one; `editing`, `adding`, `revealRemove`, `renaming` and `state` let
 * it draw the form open, a new row just added, a remove button held as on
 * hover, a name being changed, and a refused save. A refused save keeps what
 * was typed and says why under it.
 */
export function DetailsView({
  details,
  save,
  editing: startEditing = false,
  adding: startAdding = false,
  revealRemove,
  renaming,
  state: startState = {},
}: {
  details: Details;
  save?: (prev: DetailsFormState, form: FormData) => Promise<DetailsFormState>;
  editing?: boolean;
  adding?: boolean;
  /** The id of an own field whose remove button shows as if pointed at. For the gallery. */
  revealRemove?: string;
  /** The id of an own field whose name box is open. For the gallery. */
  renaming?: string;
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
  // A refused save draws what was typed, so the count follows that, not the
  // stored row the form no longer shows.
  const setCount = DETAIL_KEYS.filter((key) =>
    state.values ? state.values[key].trim() !== '' : shown[key] !== null,
  ).length;
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
                revealRemove={revealRemove}
                renaming={renaming}
                onCancel={() => {
                  setEditing(false);
                  setAdding(false);
                }}
              />
            ) : (
              <div className="space-y-4">
                <ValueList className="space-y-3">
                  {DETAIL_KEYS.map((key) => (
                    <DetailRow
                      key={key}
                      label={DETAIL_LABELS[key]}
                      value={readValue(key, shown[key])}
                    />
                  ))}
                  {shown.custom_fields.map((field) => (
                    <DetailRow key={field.id} label={field.label} value={field.value} />
                  ))}
                </ValueList>
                {canAdd ? (
                  <AddTrigger
                    label="Add a field"
                    className={ADD_FIELD}
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
          {/* No "0 of 6" while none is set (law 1): the sentence says it alone. */}
          {setCount > 0 ? (
            <Stat value={`${setCount} of ${DETAIL_KEYS.length}`} label="details set" />
          ) : null}
          <p className="text-small text-ink-muted">
            Dash reads all of these, and any fields you add, when it answers you or works on your
            goals.
          </p>
        </Card>
      }
    />
  );
}

/**
 * Add a field in ink, at a link's weight: on this tab it is the one way to
 * grow the list, so it is not left in ghost beside the "Not set" values.
 */
const ADD_FIELD = 'font-medium text-ink hover:text-ink';

/**
 * One detail, read: its name and its value on one line at every width, the
 * name in a column that wraps a long one, so each fact takes one line on a
 * phone rather than twelve. ValueRow stacks them below 448px, which suits a
 * long value under a short name but doubles a list of short answers.
 */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  const empty =
    value === null || value === undefined || (typeof value === 'string' && !value.trim());
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-28 shrink-0 text-small text-ink-muted [overflow-wrap:anywhere] @md:w-40">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-ui leading-relaxed text-ink">
        {empty ? (
          <span className="text-ink-ghost">Not set</span>
        ) : typeof value === 'string' ? (
          <LinkedText text={value} refs={false} />
        ) : (
          value
        )}
      </dd>
    </div>
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
  revealRemove,
  renaming,
  onCancel,
}: {
  details: Details;
  state: DetailsFormState;
  action: (form: FormData) => void;
  pending: boolean;
  adding: boolean;
  revealRemove?: string;
  renaming?: string;
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
        revealRemove={revealRemove}
        renaming={renaming}
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
 * drawn as the fixed details are, a name over a box, except that pressing the name
 * renames the field where it stands (law 12, OwnFieldName), with a remove
 * button beside it that shows when the field is pointed at or holds focus,
 * and always on a phone. Removing asks nothing: the field's text is still in
 * the form until Save, and Cancel brings it back.
 *
 * The list travels as one hidden `custom_fields` JSON value, so a Save
 * replaces the stored list with exactly what the form shows. An error shows
 * under the field it is about as soon as it is true.
 *
 * Add a field puts a new row at the end with the caret in its name, in one
 * press, so the form's own Save and Cancel are the only buttons it has. A new
 * row left with no name and no value is not an error: it is left out of the
 * list Save sends, as if it had never been added.
 */
function OwnFields({
  initial,
  adding,
  revealRemove,
  renaming,
}: {
  initial: CustomField[];
  adding: boolean;
  revealRemove?: string;
  renaming?: string;
}) {
  // useId, not a random id, for the row added before the form first draws:
  // the gallery renders it on the server, and the two ids must agree.
  const firstNew = `new${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [fields, setFields] = useState<CustomField[]>(() =>
    adding && initial.length < CUSTOM_FIELDS_MAX
      ? [...initial, { id: firstNew, label: '', value: '' }]
      : initial,
  );
  const [fresh, setFresh] = useState<string | undefined>(adding ? firstNew : undefined);
  const kept = fields.filter((field) => field.label.trim() || field.value.trim());
  const errors = customFieldErrors(kept);
  const canAdd = fields.length < CUSTOM_FIELDS_MAX;

  const change = (id: string, patch: Partial<CustomField>) =>
    setFields((list) => list.map((field) => (field.id === id ? { ...field, ...patch } : field)));

  const add = () => {
    if (!canAdd) return;
    const id = crypto.randomUUID();
    setFields((list) => [...list, { id, label: '', value: '' }]);
    setFresh(id);
  };

  return (
    <div className={cn('space-y-5', fields.length > 0 && 'border-t border-border pt-5')}>
      <input type="hidden" name="custom_fields" value={JSON.stringify(kept)} />
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
                    startRenaming={field.id === fresh || field.id === renaming}
                    describedBy={errorId}
                    onChange={(label) => change(field.id, { label })}
                  />
                  <Tooltip
                    label="Remove this field"
                    align="end"
                    defaultOpen={shown}
                    className="ml-auto shrink-0"
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
      {canAdd ? (
        <AddTrigger label="Add a field" className={ADD_FIELD} onClick={add} />
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
 * text set as the fixed labels are, wrapping when long, over a dashed underline
 * the fixed ones do not have, so it reads as something that can be changed; pressed,
 * it becomes a box holding the name, 16px on a phone so iOS does not zoom the
 * page, and Enter, Escape or leaving it puts the text back. A field with no
 * name shows "Add a name" in the box's place, drawn as a box with a danger
 * outline while that is what stops the save.
 */
function OwnFieldName({
  id,
  label,
  invalid,
  startRenaming = false,
  describedBy,
  onChange,
}: {
  id: string;
  label: string;
  invalid: boolean;
  /** Open with the name box showing and the caret in it: a row just added. */
  startRenaming?: boolean;
  describedBy?: string;
  onChange: (label: string) => void;
}) {
  const [renaming, setRenaming] = useState(startRenaming);
  // A field with no name keeps its box open, outlined in the danger colour,
  // so the place to type the name is where the error points.
  if (renaming || invalid) {
    return (
      <div className="relative min-w-0 flex-1">
        <PressLabel htmlFor={id} />
        <InlineInput
          id={id}
          value={label}
          onChange={(event) => onChange(event.target.value)}
          // Focus holds the box open, so naming a field with no name does not
          // close it at the first letter, when it stops being an error.
          onFocus={() => setRenaming(true)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          aria-label="Name of this field"
          placeholder={invalid ? 'Add a name' : 'Name, such as Passport number'}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoFocus={renaming}
          className={cn(
            'relative bg-surface px-2 py-1 font-medium text-ink hover:bg-surface sm:text-small',
            // Drawn focused for as long as it is open by a press, since
            // leaving it closes it: the value boxes' focus outline and ring.
            renaming
              ? 'border-accent ring-1 ring-accent/40'
              : 'border-danger placeholder:text-danger',
          )}
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
        linkVariants({ tone: 'quiet' }),
        'press min-w-0 rounded-control text-left text-small font-medium [overflow-wrap:anywhere]',
        'decoration-dashed hover:bg-sunken',
        !label.trim() && 'text-ink-ghost',
      )}
    >
      {label.trim() || 'Add a name'}
    </button>
  );
}
