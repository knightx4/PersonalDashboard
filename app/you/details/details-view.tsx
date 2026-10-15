'use client';

import { useActionState, useState } from 'react';
import { MainRail } from '@/components/patterns/main-rail';
import { PageHeader } from '@/components/shell/page-header';
import { Button, PRESS_AREA } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldError, Input } from '@/components/ui/field';
import { linkVariants } from '@/components/ui/link';
import { Stat } from '@/components/ui/stat';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import {
  DETAIL_KEYS,
  DETAIL_LABELS,
  DETAIL_MAX,
  linkedinHref,
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
 * list of answers, each "Not set" until given. One Edit turns the list into
 * the six fields in the same place (law 14), and Save puts the answers back.
 * The rail says how many are set and who reads them.
 *
 * `save` is the server action, passed in so the gallery can draw the tab
 * without one; `editing` and `state` let it draw the form open and a refused
 * save. A refused save keeps what was typed and says why under it.
 */
export function DetailsView({
  details,
  save,
  editing: startEditing = false,
  state: startState = {},
}: {
  details: Details;
  save?: (prev: DetailsFormState, form: FormData) => Promise<DetailsFormState>;
  editing?: boolean;
  state?: DetailsFormState;
}) {
  const [state, action, pending] = useActionState(save ?? (async (prev: DetailsFormState) => prev), startState);
  const [editing, setEditing] = useState(startEditing);

  // Close the form once a save lands, adjusted during render rather than in
  // an effect (React's own pattern, and the one the lint rule leaves standing).
  const [seen, setSeen] = useState<DetailsFormState>(state);
  if (state !== seen) {
    setSeen(state);
    if (state.saved) setEditing(false);
  }

  const shown = state.saved ?? details;
  const setCount = DETAIL_KEYS.filter((key) => shown[key] !== null).length;

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
                onCancel={() => setEditing(false)}
              />
            ) : (
              <ValueList className="space-y-3">
                {DETAIL_KEYS.map((key) => (
                  <ValueRow key={key} label={DETAIL_LABELS[key]} value={readValue(key, shown[key])} />
                ))}
              </ValueList>
            )}
          </Card>
        </>
      }
      rail={
        <Card padding="standard" className="space-y-3">
          <Stat value={`${setCount} of ${DETAIL_KEYS.length}`} label="details set" />
          <p className="text-small text-ink-muted">
            Dash reads all six when it answers you or works on your goals.
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
      <a href={linkedinHref(value)} target="_blank" rel="noreferrer" className={cn(PRESS_AREA, linkVariants())}>
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
  onCancel,
}: {
  details: Details;
  state: DetailsFormState;
  action: (form: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const errors = state.errors ?? {};
  const valueOf = (key: DetailKey) => state.values?.[key] ?? details[key] ?? '';
  return (
    <form key={state.values ? JSON.stringify(state.values) : 'first'} action={action} className="space-y-5">
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
      <p className="text-small text-ink-muted">Leave a field empty to clear it.</p>
      <FieldError>{state.error}</FieldError>
      <div className="flex flex-wrap items-center justify-end gap-2">
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
