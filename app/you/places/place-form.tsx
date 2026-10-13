'use client';

import { useActionState } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { draftOf, NAME_MAX, NOTE_MAX, placeHref, type Place } from '@/lib/you/places';
import type { PlaceFormState } from './actions';

/**
 * Adding a place, or changing one (plan #1991.5). One column of fields in the
 * order a person remembers a home: what they call it, where it is, when they
 * moved in and out, then anything else.
 *
 * The dates take a year or a month and year, typed the way they come to
 * mind ('2019', 'March 2019', '3/2019'); lib/you/places.ts reads them. An
 * empty moved-out date is the home they live in now.
 *
 * `save` is the server action, passed in so the gallery can draw the form
 * without one. React clears a form after its action, so a refused save
 * sends back what was typed and the fields are drawn again from it.
 */
export function PlaceForm({
  place,
  save,
}: {
  place: Place | null;
  save?: (prev: PlaceFormState, form: FormData) => Promise<PlaceFormState>;
}) {
  const [state, action, pending] = useActionState(
    save ?? (async (prev: PlaceFormState) => prev),
    {} as PlaceFormState,
  );
  const draft = state.values ?? draftOf(place);
  const errors = state.errors ?? {};
  const back = place ? placeHref(place.id) : '/you/places';

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={place ? `Edit ${place.name}` : 'Add a place'}
        crumbs={[
          { label: 'You', href: '/you' },
          { label: 'Places', href: '/you/places' },
          place
            ? { label: place.name, href: placeHref(place.id) }
            : { label: 'Add a place', href: '/you/places/new' },
        ]}
      />
      <Card padding="standard">
        <form key={state.values ? JSON.stringify(state.values) : 'first'} action={action} className="space-y-5">
          {place && <input type="hidden" name="id" value={place.id} />}
          <Field
            id="place-name"
            label="Name"
            hint="What you call it: the street, the house, or just the city."
            error={errors.name}
          >
            <Input
              id="place-name"
              name="name"
              defaultValue={draft.name}
              maxLength={NAME_MAX}
              required
              autoFocus={!place}
              autoComplete="off"
            />
          </Field>

          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-5">
            <Field id="place-city" label="City" error={errors.city}>
              <Input id="place-city" name="city" defaultValue={draft.city} maxLength={NAME_MAX} autoComplete="address-level2" />
            </Field>
            <Field id="place-region" label="Region" error={errors.region}>
              <Input id="place-region" name="region" defaultValue={draft.region} maxLength={NAME_MAX} autoComplete="address-level1" />
            </Field>
            <Field id="place-country" label="Country" error={errors.country} className="col-span-2 sm:col-span-1">
              <Input id="place-country" name="country" defaultValue={draft.country} maxLength={NAME_MAX} autoComplete="country-name" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-5">
            <Field id="place-moved-in" label="Moved in" error={errors.movedIn}>
              <Input
                id="place-moved-in"
                name="moved_in"
                defaultValue={draft.movedIn}
                placeholder="2019 or Mar 2019"
                required
                autoComplete="off"
              />
            </Field>
            <Field id="place-moved-out" label="Moved out" error={errors.movedOut}>
              <Input
                id="place-moved-out"
                name="moved_out"
                defaultValue={draft.movedOut}
                placeholder="Still there"
                autoComplete="off"
              />
            </Field>
          </div>

          <Field id="place-note" label="Note" error={errors.note}>
            <Textarea id="place-note" name="note" defaultValue={draft.note} maxLength={NOTE_MAX} rows={3} />
          </Field>

          <FieldError>{state.error}</FieldError>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link href={back} className={buttonVariants({ variant: 'ghost', size: 'md' })}>
              Cancel
            </Link>
            <Button type="submit" variant="primary" size="md" pending={pending}>
              {pending ? 'Saving…' : place ? 'Save' : 'Add place'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
